-- Section H bridge: optimistic concurrency for the legacy application-state
-- JSON document. This is not a substitute for normalized social/safety tables.
-- Apply in STAGING first, after an independently verified database backup.
-- This migration DOES NOT import, delete, reseed, or approve finance records.
begin;

create table if not exists public.visplay_app_state (
  id text primary key check (id = 'main'),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  revision bigint not null default 0 check (revision >= 0)
);

alter table public.visplay_app_state
  add column if not exists revision bigint not null default 0;

alter table public.visplay_app_state enable row level security;
revoke all on public.visplay_app_state from public, anon, authenticated;
grant select, insert, update on public.visplay_app_state to service_role;

-- The row must already exist: this function never creates demo data or
-- silently overwrites another instance's newer write.
create or replace function public.visplay_commit_app_state(
  p_expected_revision bigint, p_data jsonb
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_new_revision bigint;
begin
  if p_expected_revision is null or p_expected_revision < 0 or p_data is null
    or jsonb_typeof(p_data) <> 'object'
    or jsonb_typeof(p_data->'users') <> 'array'
    or jsonb_typeof(p_data->'movies') <> 'array'
    or jsonb_typeof(p_data->'creator_profiles') <> 'array'
    or jsonb_typeof(p_data->'audit_logs') <> 'array' then
    raise exception 'VISPLAY_STATE_INVALID' using errcode = 'P0001';
  end if;

  update public.visplay_app_state
     set data = p_data, updated_at = now(), revision = revision + 1
   where id = 'main' and revision = p_expected_revision
   returning revision into v_new_revision;
  if not found then
    raise exception 'VISPLAY_STATE_CONFLICT' using errcode = 'P0001';
  end if;
  return v_new_revision;
end;
$$;

revoke all on function public.visplay_commit_app_state(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.visplay_commit_app_state(bigint,jsonb) to service_role;

commit;

-- IMPORTANT: This revision bridge prevents silent lost updates but does NOT
-- make the existing JSON application state a production-grade multi-instance
-- database. Section H still requires normalized safety/social/creator records,
-- a transactional event log, and a security/DBA-reviewed migration.
