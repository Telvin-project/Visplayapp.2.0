-- Section D: the canonical VisPlay financial core.
-- Apply in staging first. Do NOT enable visplay_finance_control.migration_approved
-- until existing money/entitlement data has been independently reconciled.
begin;

create table if not exists public.visplay_finance_control (
  id text primary key check (id = 'main'),
  migration_approved boolean not null default false,
  approved_at timestamptz,
  approval_reference text
);
insert into public.visplay_finance_control (id) values ('main') on conflict (id) do nothing;

create table if not exists public.visplay_finance_wallets (
  user_id text primary key,
  balance_ngn bigint not null default 0 check (balance_ngn >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.visplay_finance_transactions (
  id text primary key default ('tx_' || gen_random_uuid()::text),
  reference text not null unique,
  user_id text not null,
  amount_ngn bigint not null check (amount_ngn > 0 and amount_ngn <= 1000000),
  intent_kind text not null check (intent_kind in ('wallet_deposit','movie_purchase','wallet_movie','wallet_bundle')),
  status text not null check (status in ('pending','successful','failed','refund_required')),
  payment_method text not null check (payment_method in ('paystack','wallet')),
  item_type text check (item_type in ('movie','bundle')),
  item_id text,
  creator_id text,
  bundle_id text,
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  check ((intent_kind = 'wallet_deposit' and item_id is null and creator_id is null)
         or (intent_kind <> 'wallet_deposit' and item_id is not null and creator_id is not null))
);
create index if not exists visplay_finance_tx_user_idx on public.visplay_finance_transactions(user_id,created_at desc);

create table if not exists public.visplay_finance_wallet_entries (
  id text primary key default ('wle_' || gen_random_uuid()::text),
  user_id text not null references public.visplay_finance_wallets(user_id) on update cascade,
  reference text not null unique references public.visplay_finance_transactions(reference),
  delta_ngn bigint not null check (delta_ngn <> 0),
  balance_after_ngn bigint not null check (balance_after_ngn >= 0),
  created_at timestamptz not null default now()
);
create index if not exists visplay_finance_wallet_entries_user_idx on public.visplay_finance_wallet_entries(user_id, created_at desc);

create table if not exists public.visplay_finance_purchases (
  id text primary key default ('pur_' || gen_random_uuid()::text),
  user_id text not null,
  item_type text not null check (item_type in ('movie','bundle')),
  item_id text not null,
  amount_ngn bigint not null check (amount_ngn > 0),
  reference text not null unique references public.visplay_finance_transactions(reference),
  created_at timestamptz not null default now(),
  unique (user_id,item_type,item_id)
);
create index if not exists visplay_finance_purchases_user_idx on public.visplay_finance_purchases(user_id);

create table if not exists public.visplay_finance_creator_ledger (
  id text primary key default ('led_' || gen_random_uuid()::text),
  creator_id text not null,
  purchase_id text not null unique references public.visplay_finance_purchases(id),
  movie_id text,
  bundle_id text,
  gross_amount_ngn bigint not null check (gross_amount_ngn > 0),
  creator_share_ngn bigint not null check (creator_share_ngn >= 0),
  platform_fee_ngn bigint not null check (platform_fee_ngn >= 0),
  status text not null default 'accrued' check (status in ('accrued','reserved','paid')),
  payout_id text,
  created_at timestamptz not null default now(),
  check (creator_share_ngn + platform_fee_ngn = gross_amount_ngn)
);
create index if not exists visplay_finance_creator_ledger_idx on public.visplay_finance_creator_ledger(creator_id,status);

create table if not exists public.visplay_finance_payouts (
  id text primary key default ('pay_' || gen_random_uuid()::text),
  creator_id text not null,
  requested_by_admin_id text not null,
  month_period text not null,
  total_earnings_ngn bigint not null check (total_earnings_ngn > 0),
  platform_fee_ngn bigint not null check (platform_fee_ngn >= 0),
  net_payout_ngn bigint not null check (net_payout_ngn >= 0),
  status text not null check (status in ('pending','processed','paid')),
  bank_name text not null default '',
  account_number text not null default '',
  account_name text not null default '',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  check (total_earnings_ngn = platform_fee_ngn + net_payout_ngn)
);
create unique index if not exists visplay_finance_one_pending_payout_idx
  on public.visplay_finance_payouts(creator_id) where status = 'pending';
alter table public.visplay_finance_creator_ledger
  drop constraint if exists visplay_finance_creator_ledger_payout_fk;
alter table public.visplay_finance_creator_ledger
  add constraint visplay_finance_creator_ledger_payout_fk foreign key (payout_id) references public.visplay_finance_payouts(id);

create table if not exists public.visplay_finance_refund_cases (
  reference text primary key references public.visplay_finance_transactions(reference),
  reason text not null,
  status text not null default 'open' check (status in ('open','in_review','refunded')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- No public tables/policies are needed. Only the server's service role can
-- read these tables and call the finance functions. Revoke direct client access.
do $$ declare t text;
begin
  foreach t in array array[
    'visplay_finance_control','visplay_finance_wallets','visplay_finance_transactions',
    'visplay_finance_wallet_entries','visplay_finance_purchases',
    'visplay_finance_creator_ledger','visplay_finance_payouts','visplay_finance_refund_cases'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.visplay_finance_create_intent(
  p_user_id text, p_reference text, p_intent_kind text,
  p_amount_ngn bigint, p_item_id text default null,
  p_creator_id text default null, p_bundle_id text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tx public.visplay_finance_transactions;
begin
  if not exists (select 1 from public.visplay_finance_control
                 where id='main' and migration_approved=true and approval_reference is not null) then
    raise exception 'FINANCE_NOT_APPROVED' using errcode = 'P0001';
  end if;
  if p_user_id is null or length(p_user_id) < 3
    or p_reference !~ '^VIS_(DEP|MOV)_[A-Za-z0-9_-]{8,100}$'
    or p_intent_kind not in ('wallet_deposit','movie_purchase') then
    raise exception 'FINANCE_BAD_INTENT' using errcode = 'P0001';
  end if;
  if p_intent_kind = 'wallet_deposit' then
    if p_amount_ngn < 100 or p_amount_ngn > 1000000 or p_item_id is not null or p_creator_id is not null then
      raise exception 'FINANCE_INVALID_AMOUNT' using errcode = 'P0001';
    end if;
  elsif p_amount_ngn <> 100 or nullif(p_item_id,'') is null or nullif(p_creator_id,'') is null then
    raise exception 'FINANCE_INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  -- Cross-instance checkout-spam control; serialize a user's intent creation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('visplay_intent_' || p_user_id));
  if (select count(*) from public.visplay_finance_transactions
      where user_id=p_user_id and payment_method='paystack' and created_at > now()-interval '1 hour') >= 12 then
    raise exception 'FINANCE_RATE_LIMIT' using errcode = 'P0001';
  end if;

  insert into public.visplay_finance_transactions
    (reference,user_id,amount_ngn,intent_kind,status,payment_method,item_type,item_id,creator_id,bundle_id,description)
  values
    (p_reference,p_user_id,p_amount_ngn,p_intent_kind,'pending','paystack',
     case when p_intent_kind = 'movie_purchase' then 'movie' else null end,
     p_item_id,p_creator_id,p_bundle_id,
     case when p_intent_kind = 'wallet_deposit' then 'Wallet deposit' else 'Direct movie payment' end)
  returning * into v_tx;
  return to_jsonb(v_tx);
end $$;

create or replace function public.visplay_finance_buy_wallet(
  p_user_id text, p_item_type text, p_item_id text, p_creator_id text,
  p_bundle_id text, p_amount_ngn bigint, p_reference text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_wallet public.visplay_finance_wallets; v_pur public.visplay_finance_purchases;
        v_ledger public.visplay_finance_creator_ledger; v_share bigint;
begin
  if not exists (select 1 from public.visplay_finance_control
                 where id='main' and migration_approved=true and approval_reference is not null) then
    raise exception 'FINANCE_NOT_APPROVED' using errcode = 'P0001';
  end if;
  if nullif(p_user_id,'') is null or nullif(p_item_id,'') is null or nullif(p_creator_id,'') is null
    or p_item_type not in ('movie','bundle') or p_reference !~ '^VIS_PUR_(MOV|BUN)_[A-Za-z0-9_-]{8,100}$'
    or p_amount_ngn <> case when p_item_type = 'movie' then 100 else 700 end then
    raise exception 'FINANCE_BAD_PURCHASE' using errcode = 'P0001';
  end if;

  insert into public.visplay_finance_wallets (user_id) values (p_user_id) on conflict do nothing;
  select * into v_wallet from public.visplay_finance_wallets where user_id = p_user_id for update;
  select * into v_pur from public.visplay_finance_purchases
    where user_id = p_user_id and
      ((item_type = p_item_type and item_id = p_item_id)
       or (p_item_type = 'movie' and item_type = 'bundle' and item_id = p_bundle_id))
    limit 1;
  if found then return jsonb_build_object('already_owned',true,'wallet_balance',v_wallet.balance_ngn,'purchase',to_jsonb(v_pur)); end if;
  if v_wallet.balance_ngn < p_amount_ngn then
    raise exception 'FINANCE_INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  insert into public.visplay_finance_transactions
    (reference,user_id,amount_ngn,intent_kind,status,payment_method,item_type,item_id,creator_id,bundle_id,description,settled_at)
  values
    (p_reference,p_user_id,p_amount_ngn,
     case when p_item_type='movie' then 'wallet_movie' else 'wallet_bundle' end,
     'successful','wallet',p_item_type,p_item_id,p_creator_id,p_bundle_id,'Wallet purchase',now());
  update public.visplay_finance_wallets set balance_ngn = balance_ngn - p_amount_ngn,updated_at=now()
    where user_id=p_user_id returning * into v_wallet;
  insert into public.visplay_finance_wallet_entries(user_id,reference,delta_ngn,balance_after_ngn)
    values(p_user_id,p_reference,-p_amount_ngn,v_wallet.balance_ngn);

  insert into public.visplay_finance_purchases(user_id,item_type,item_id,amount_ngn,reference)
    values(p_user_id,p_item_type,p_item_id,p_amount_ngn,p_reference) returning * into v_pur;
  v_share := (p_amount_ngn * 85 + 50) / 100;
  insert into public.visplay_finance_creator_ledger
    (creator_id,purchase_id,movie_id,bundle_id,gross_amount_ngn,creator_share_ngn,platform_fee_ngn)
  values
    (p_creator_id,v_pur.id,case when p_item_type='movie' then p_item_id else null end,
     case when p_item_type='bundle' then p_item_id else null end,p_amount_ngn,v_share,p_amount_ngn-v_share)
  returning * into v_ledger;
  return jsonb_build_object('already_owned',false,'wallet_balance',v_wallet.balance_ngn,
                            'purchase',to_jsonb(v_pur),'ledger',to_jsonb(v_ledger));
end $$;

create or replace function public.visplay_finance_settle_paystack(
  p_reference text, p_paystack_amount_kobo bigint, p_currency text,
  p_status text, p_purpose text, p_user_id text, p_item_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tx public.visplay_finance_transactions; v_wallet public.visplay_finance_wallets;
        v_pur public.visplay_finance_purchases; v_ledger public.visplay_finance_creator_ledger;
        v_share bigint; v_existing boolean;
begin
  if not exists (select 1 from public.visplay_finance_control
                 where id='main' and migration_approved=true and approval_reference is not null) then
    raise exception 'FINANCE_NOT_APPROVED' using errcode = 'P0001';
  end if;
  select * into v_tx from public.visplay_finance_transactions where reference=p_reference for update;
  if not found then raise exception 'FINANCE_UNKNOWN_REFERENCE' using errcode = 'P0001'; end if;
  if p_status <> 'success' or p_currency <> 'NGN' or p_paystack_amount_kobo <> v_tx.amount_ngn * 100
    or p_user_id is distinct from v_tx.user_id or p_purpose is distinct from v_tx.intent_kind
    or (v_tx.intent_kind='movie_purchase' and p_item_id is distinct from v_tx.item_id)
    or v_tx.payment_method <> 'paystack' then
    raise exception 'FINANCE_PROVIDER_MISMATCH' using errcode = 'P0001';
  end if;
  if v_tx.status = 'successful' then
    select * into v_wallet from public.visplay_finance_wallets where user_id=v_tx.user_id;
    select * into v_pur from public.visplay_finance_purchases where reference=v_tx.reference;
    return jsonb_build_object('already_verified',true,'wallet_balance',coalesce(v_wallet.balance_ngn,0),
                              'purchase',case when v_pur.id is null then null else to_jsonb(v_pur) end);
  end if;
  if v_tx.status = 'refund_required' then return jsonb_build_object('refund_required',true); end if;
  if v_tx.status <> 'pending' then raise exception 'FINANCE_PAYMENT_NOT_PENDING' using errcode = 'P0001'; end if;

  if v_tx.intent_kind = 'wallet_deposit' then
    insert into public.visplay_finance_wallets(user_id) values(v_tx.user_id) on conflict do nothing;
    select * into v_wallet from public.visplay_finance_wallets where user_id=v_tx.user_id for update;
    update public.visplay_finance_wallets set balance_ngn=balance_ngn+v_tx.amount_ngn,updated_at=now()
      where user_id=v_tx.user_id returning * into v_wallet;
    insert into public.visplay_finance_wallet_entries(user_id,reference,delta_ngn,balance_after_ngn)
      values(v_tx.user_id,v_tx.reference,v_tx.amount_ngn,v_wallet.balance_ngn);
  else
    select exists(select 1 from public.visplay_finance_purchases where user_id=v_tx.user_id and
      ((item_type='movie' and item_id=v_tx.item_id)
       or (item_type='bundle' and item_id=v_tx.bundle_id))) into v_existing;
    if v_existing then
      insert into public.visplay_finance_refund_cases(reference,reason)
        values(v_tx.reference,'Payment succeeded after the customer already owned the movie')
        on conflict do nothing;
      update public.visplay_finance_transactions set status='refund_required',settled_at=now() where reference=v_tx.reference;
      return jsonb_build_object('refund_required',true);
    end if;
    insert into public.visplay_finance_purchases(user_id,item_type,item_id,amount_ngn,reference)
      values(v_tx.user_id,'movie',v_tx.item_id,v_tx.amount_ngn,v_tx.reference)
      on conflict (user_id,item_type,item_id) do nothing returning * into v_pur;
    if v_pur.id is null then
      insert into public.visplay_finance_refund_cases(reference,reason)
        values(v_tx.reference,'Concurrent duplicate payment for an already-owned movie') on conflict do nothing;
      update public.visplay_finance_transactions set status='refund_required',settled_at=now() where reference=v_tx.reference;
      return jsonb_build_object('refund_required',true);
    end if;
    v_share := (v_tx.amount_ngn * 85 + 50) / 100;
    insert into public.visplay_finance_creator_ledger
      (creator_id,purchase_id,movie_id,gross_amount_ngn,creator_share_ngn,platform_fee_ngn)
      values(v_tx.creator_id,v_pur.id,v_tx.item_id,v_tx.amount_ngn,v_share,v_tx.amount_ngn-v_share)
      returning * into v_ledger;
  end if;
  update public.visplay_finance_transactions set status='successful',settled_at=now() where reference=v_tx.reference;
  return jsonb_build_object('success',true,'wallet_balance',coalesce(v_wallet.balance_ngn,0),
                            'purchase',case when v_pur.id is null then null else to_jsonb(v_pur) end,
                            'ledger',case when v_ledger.id is null then null else to_jsonb(v_ledger) end);
end $$;

create or replace function public.visplay_finance_reserve_payout(p_creator_id text,p_month_period text,p_admin_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_payout public.visplay_finance_payouts; v_gross bigint; v_fee bigint; v_net bigint;
begin
  if not exists (select 1 from public.visplay_finance_control
                 where id='main' and migration_approved=true and approval_reference is not null) then
    raise exception 'FINANCE_NOT_APPROVED' using errcode = 'P0001';
  end if;
  if nullif(p_creator_id,'') is null or nullif(p_admin_id,'') is null
    or length(trim(coalesce(p_month_period,''))) not between 3 and 64 then
    raise exception 'FINANCE_BAD_PAYOUT' using errcode = 'P0001';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('visplay_payout_' || p_creator_id));
  if exists(select 1 from public.visplay_finance_payouts where creator_id=p_creator_id and status='pending') then
    raise exception 'FINANCE_PAYOUT_PENDING' using errcode = 'P0001';
  end if;
  select sum(gross_amount_ngn),sum(platform_fee_ngn),sum(creator_share_ngn)
    into v_gross,v_fee,v_net from public.visplay_finance_creator_ledger
    where creator_id=p_creator_id and status='accrued';
  if coalesce(v_gross,0)=0 then raise exception 'FINANCE_NO_EARNINGS' using errcode = 'P0001'; end if;
  insert into public.visplay_finance_payouts
    (creator_id,requested_by_admin_id,month_period,total_earnings_ngn,platform_fee_ngn,net_payout_ngn,status)
    values(p_creator_id,p_admin_id,trim(p_month_period),v_gross,v_fee,v_net,'pending') returning * into v_payout;
  update public.visplay_finance_creator_ledger set status='reserved',payout_id=v_payout.id
    where creator_id=p_creator_id and status='accrued';
  return to_jsonb(v_payout);
end $$;

create or replace function public.visplay_finance_anonymize_user(p_user_id text,p_deleted_id text,p_creator_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_wallet public.visplay_finance_wallets;
begin
  if not exists (select 1 from public.visplay_finance_control
                 where id='main' and migration_approved=true and approval_reference is not null) then
    raise exception 'FINANCE_NOT_APPROVED' using errcode = 'P0001';
  end if;
  if nullif(p_user_id,'') is null or p_deleted_id !~ '^deleted_[a-f0-9]{16,64}$' then
    raise exception 'FINANCE_BAD_ANONYMIZATION' using errcode = 'P0001';
  end if;
  select * into v_wallet from public.visplay_finance_wallets where user_id=p_user_id for update;
  if coalesce(v_wallet.balance_ngn,0) <> 0 then
    raise exception 'FINANCE_WALLET_NOT_ZERO' using errcode = 'P0001';
  end if;
  update public.visplay_finance_transactions set user_id=p_deleted_id where user_id=p_user_id;
  update public.visplay_finance_purchases set user_id=p_deleted_id where user_id=p_user_id;
  update public.visplay_finance_wallets set user_id=p_deleted_id where user_id=p_user_id;
  update public.visplay_finance_payouts set requested_by_admin_id=p_deleted_id where requested_by_admin_id=p_user_id;
  if p_creator_id is not null then
    update public.visplay_finance_creator_ledger set creator_id=p_deleted_id where creator_id=p_creator_id;
    update public.visplay_finance_payouts set creator_id=p_deleted_id,bank_name='',account_name='',account_number=''
      where creator_id=p_creator_id;
  end if;
  return jsonb_build_object('anonymized',true);
end $$;

create or replace function public.visplay_finance_admin_metrics()
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'gross_sales_ngn', coalesce((select sum(gross_amount_ngn) from public.visplay_finance_creator_ledger),0),
    'creator_share_ngn', coalesce((select sum(creator_share_ngn) from public.visplay_finance_creator_ledger),0),
    'platform_revenue_ngn', coalesce((select sum(platform_fee_ngn) from public.visplay_finance_creator_ledger),0),
    'wallet_deposits_ngn', coalesce((select sum(amount_ngn) from public.visplay_finance_transactions
        where intent_kind='wallet_deposit' and status='successful'),0),
    'total_paid_unlocks', (select count(*) from public.visplay_finance_purchases)
  )
$$;

create or replace function public.visplay_finance_creator_summary(p_creator_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'total_earnings_ngn', coalesce((select sum(creator_share_ngn) from public.visplay_finance_creator_ledger
      where creator_id=p_creator_id),0),
    'pending_payout_ngn', coalesce((select sum(creator_share_ngn) from public.visplay_finance_creator_ledger
      where creator_id=p_creator_id and status <> 'paid'),0),
    'total_paid_out_ngn', coalesce((select sum(net_payout_ngn) from public.visplay_finance_payouts
      where creator_id=p_creator_id and status='paid'),0),
    'total_paid_unlocks', (select count(*) from public.visplay_finance_creator_ledger where creator_id=p_creator_id)
  )
$$;

create or replace function public.visplay_finance_movie_sales()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_object_agg(movie_id, totals), '{}'::jsonb) from (
    select movie_id, pg_catalog.jsonb_build_object(
      'gross_sales_ngn',sum(gross_amount_ngn),
      'creator_share_ngn',sum(creator_share_ngn),
      'platform_fee_ngn',sum(platform_fee_ngn)) as totals
    from public.visplay_finance_creator_ledger
    where movie_id is not null
    group by movie_id
  ) as movie_totals
$$;

do $$ declare f text;
begin
  foreach f in array array[
    'visplay_finance_create_intent(text,text,text,bigint,text,text,text)',
    'visplay_finance_buy_wallet(text,text,text,text,text,bigint,text)',
    'visplay_finance_settle_paystack(text,bigint,text,text,text,text,text)',
    'visplay_finance_reserve_payout(text,text,text)',
    'visplay_finance_anonymize_user(text,text,text)',
    'visplay_finance_admin_metrics()',
    'visplay_finance_creator_summary(text)',
    'visplay_finance_movie_sales()'
  ] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;
commit;
