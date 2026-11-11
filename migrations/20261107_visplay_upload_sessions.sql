-- Apply to the SAME Supabase PostgreSQL project used by the VisPlay server.
-- Service-role only; browser auth users must NOT access this table or RPC.
create table if not exists public.visplay_upload_sessions (
  id uuid primary key,
  user_id text not null,
  kind text not null check (kind in ('video','image')),
  usage text not null check (usage in ('movie','poster','avatar','banner')),
  content_type text not null,
  expected_size bigint not null check (expected_size > 0 and expected_size <= 524288000),
  staging_key text not null unique,
  upload_id text,
  status text not null default 'created' check (status in ('created','processing','ready','attaching','consumed','failed','aborted')),
  final_key text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '6 hours'),
  updated_at timestamptz not null default now(),
  constraint media_upload_kind_usage check ((kind = 'video' and usage = 'movie') or (kind = 'image' and usage in ('poster','avatar','banner')))
);

create index if not exists idx_visplay_upload_user_created on public.visplay_upload_sessions (user_id, created_at desc);
create index if not exists idx_visplay_upload_expiry on public.visplay_upload_sessions (status, expires_at);
alter table public.visplay_upload_sessions enable row level security;
revoke all on public.visplay_upload_sessions from anon, authenticated, public;
grant select, insert, update on public.visplay_upload_sessions to service_role;

create or replace function public.visplay_create_media_upload(
  p_id uuid, p_user_id text, p_kind text, p_usage text, p_content_type text,
  p_expected_size bigint, p_staging_key text, p_upload_id text
) returns public.visplay_upload_sessions
language plpgsql security definer set search_path = public
as $$
declare active_uploads integer;
declare daily_sessions integer;
declare daily_bytes bigint;
declare result public.visplay_upload_sessions;
begin
  if p_user_id is null or length(p_user_id) > 100 or length(p_user_id) = 0 or
     p_expected_size is null or p_expected_size <= 0 or p_expected_size > 524288000 or
     p_kind not in ('video','image') or
     (p_kind = 'video' and p_usage <> 'movie') or
     (p_kind = 'image' and p_usage not in ('poster','avatar','banner')) then
    raise exception 'invalid upload session';
  end if;
  -- Locks concurrent quota reservations for one creator, including across pods.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id, 42177));
  select count(*) into active_uploads from public.visplay_upload_sessions
    where user_id = p_user_id and status in ('created','processing','attaching') and expires_at > now();
  select coalesce(sum(expected_size),0) into daily_bytes from public.visplay_upload_sessions
    where user_id = p_user_id and created_at >= now() - interval '24 hours';
  select count(*) into daily_sessions from public.visplay_upload_sessions
    where user_id = p_user_id and created_at >= now() - interval '24 hours';
  if active_uploads >= 3 or daily_sessions >= 30 or daily_bytes + p_expected_size > 1073741824 then
    raise exception 'upload quota exceeded';
  end if;
  insert into public.visplay_upload_sessions
    (id,user_id,kind,usage,content_type,expected_size,staging_key,upload_id)
    values (p_id,p_user_id,p_kind,p_usage,p_content_type,p_expected_size,p_staging_key,p_upload_id)
    returning * into result;
  return result;
end;
$$;

revoke all on function public.visplay_create_media_upload(uuid,text,text,text,text,bigint,text,text) from public, anon, authenticated;
grant execute on function public.visplay_create_media_upload(uuid,text,text,text,text,bigint,text,text) to service_role;

-- Do not expire private videos or finalized public images. Configure R2 lifecycle
-- deletion ONLY for staging/ prefix and abort unfinished multipart after <=1 day.
-- Session rows are retained for security audits and quota calculations; plan
-- an operator retention/cleanup policy before production.
