/*
# NANZO SIGNED VAULT — foundation (tables + passkey/session authorization)

## 1. Plain-English summary
The Signed Vault is a private collector platform inside the NANZO site.
Exactly two authorized collectors may access it. The site has no login
system, so access uses the same proven pattern as staff management:
passkeys checked inside SECURITY DEFINER database functions, plus
short-lived session tokens. Every vault read/write goes through
passkey/token-checked RPCs; the data tables themselves are locked so
that browser code with the public anon key can read NOTHING directly.

## 2. New tables (all RLS enabled, no policies -> deny-all to anon)
- `vault_collectors`, `vault_access_config`, `vault_sessions`,
  `vault_settings`, `vault_pet_catalog`, `vault_signers`,
  `vault_signatures`, `vault_pets`, `vault_acquisitions`,
  `vault_value_snapshots`, `vault_cosmic_values`,
  `vault_verification_requests`, `vault_oauth_tokens` (service_role only),
  `vault_audit_log` (service_role read only). Column details in schema.

## 3. Security
- Every table: RLS ENABLED, no policies, REVOKE ALL from anon/authenticated.
  Only service_role (edge functions) has access; all browser access is
  mediated by SECURITY DEFINER RPCs.
- pgcrypto (extensions schema) for SHA-256 hashing; passkeys and session
  tokens are stored hashed only.
- `vault_setup` EXECUTE: service_role only. `vault_login`, `vault_session`,
  `vault_logout`: anon + authenticated (the only public entry points).
- OUT parameters of table-returning functions are disambiguated with the
  `rec_` prefix so they cannot collide with table column names.
*/

create extension if not exists pgcrypto schema extensions;

create table if not exists public.vault_collectors (
  id uuid primary key default gen_random_uuid(),
  collector_no integer not null unique check (collector_no in (1,2)),
  label text not null,
  is_owner boolean not null default false,
  roblox_username text,
  roblox_user_id bigint,
  avatar_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_access_config (
  collector_no integer primary key check (collector_no in (1,2)),
  passkey_hash text not null default encode(extensions.digest('', 'sha256'), 'hex'),
  passkey_salt text not null default '',
  setup_required boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_sessions (
  token_hash text primary key,
  collector_no integer not null check (collector_no in (1,2)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.vault_settings (
  id boolean primary key default true,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_pet_catalog (
  id uuid primary key default gen_random_uuid(),
  pet_name text not null unique,
  category text not null default 'Signed',
  image_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_signers (
  id uuid primary key default gen_random_uuid(),
  signer_name text not null unique,
  roblox_username text,
  roblox_user_id bigint,
  avatar_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_signatures (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.vault_pet_catalog(id) on delete cascade,
  signer_id uuid not null references public.vault_signers(id) on delete cascade,
  variant text not null default 'normal' check (variant in ('normal','golden','rainbow','shiny')),
  notes text,
  created_at timestamptz not null default now(),
  unique (pet_id, signer_id, variant)
);

create table if not exists public.vault_pets (
  id uuid primary key default gen_random_uuid(),
  collector_no integer not null check (collector_no in (1,2)),
  pet_id uuid not null references public.vault_pet_catalog(id) on delete cascade,
  signer_id uuid references public.vault_signers(id) on delete set null,
  variant text not null default 'normal' check (variant in ('normal','golden','rainbow','shiny')),
  nickname text,
  acquired_at date,
  purchase_price numeric(20,2),
  currency text not null default 'USD',
  raw_data jsonb,
  inventory_uid text,
  added_by text not null default 'manual',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vault_pets_collector_uid_key
  on public.vault_pets (collector_no, inventory_uid)
  where inventory_uid is not null;
create index if not exists vault_pets_collector_idx on public.vault_pets (collector_no);
create index if not exists vault_pets_pet_idx on public.vault_pets (pet_id);

create table if not exists public.vault_acquisitions (
  id uuid primary key default gen_random_uuid(),
  collector_no integer not null check (collector_no in (1,2)),
  pet_id uuid not null references public.vault_pet_catalog(id) on delete cascade,
  signer_id uuid references public.vault_signers(id) on delete set null,
  variant text not null default 'normal',
  acquired_at date,
  purchase_price numeric(20,2),
  currency text not null default 'USD',
  source text not null default 'manual' check (source in ('manual','sync','trade','gift')),
  sync_batch_id uuid,
  pet_inventory_id uuid,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists vault_acquisitions_collector_idx on public.vault_acquisitions (collector_no);

create table if not exists public.vault_value_snapshots (
  id uuid primary key default gen_random_uuid(),
  collector_no integer not null check (collector_no in (1,2)),
  total_value numeric(20,2) not null default 0,
  pet_count integer not null default 0,
  captured_at timestamptz not null default now()
);
create index if not exists vault_value_snapshots_collector_idx on public.vault_value_snapshots (collector_no);

create table if not exists public.vault_cosmic_values (
  pet_id uuid primary key references public.vault_pet_catalog(id) on delete cascade,
  cosmic_value numeric(20,2),
  demand integer check (demand between 1 and 10),
  source text not null default 'manual',
  fetched_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_verification_requests (
  id uuid primary key default gen_random_uuid(),
  collector_no integer not null check (collector_no in (1,2)),
  pet_id uuid not null references public.vault_pet_catalog(id) on delete cascade,
  signer_id uuid references public.vault_signers(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  evidence_url text,
  notes text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.vault_oauth_tokens (
  collector_no integer primary key check (collector_no in (1,2)),
  access_token text,
  token_scope text,
  expires_at timestamptz,
  roblox_user_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_audit_log (
  id uuid primary key default gen_random_uuid(),
  collector_no integer,
  actor text not null,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ── lockdown: no browser role touches any vault table directly ──────
do $$
declare t text;
begin
  foreach t in array array[
    'vault_collectors','vault_access_config','vault_sessions','vault_settings',
    'vault_pet_catalog','vault_signers','vault_signatures','vault_pets',
    'vault_acquisitions','vault_value_snapshots','vault_cosmic_values',
    'vault_verification_requests','vault_oauth_tokens','vault_audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ── seeding ─────────────────────────────────────────────────────────
insert into public.vault_collectors (collector_no, label, is_owner)
values (1, 'Collector 1 (Owner)', true), (2, 'Collector 2', false)
on conflict (collector_no) do nothing;

insert into public.vault_access_config (collector_no) values (1), (2)
on conflict (collector_no) do nothing;

insert into public.vault_settings (id) values (true) on conflict (id) do nothing;

-- ── authorization functions ─────────────────────────────────────────

create or replace function public.vault_hash_secret(p_secret text)
returns text
language sql
immutable
security definer
set search_path = public, extensions
as $$
  select encode(digest(coalesce(p_secret, ''), 'sha256'), 'hex')
$$;

create or replace function public.vault_login(p_passkey text)
returns table (out_token text, out_collector_no integer, out_is_owner boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_no integer;
  v_token text;
begin
  if p_passkey is null or length(btrim(p_passkey)) < 6 then
    raise exception 'vault_access_denied';
  end if;

  select c.collector_no into v_no
  from public.vault_access_config a
  join public.vault_collectors c on c.collector_no = a.collector_no
  where a.setup_required = false
    and a.passkey_hash = public.vault_hash_secret(btrim(p_passkey));

  if v_no is null then
    raise exception 'vault_access_denied';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.vault_sessions (token_hash, collector_no, expires_at)
  values (public.vault_hash_secret(v_token), v_no, now() + interval '7 days');

  insert into public.vault_audit_log (collector_no, actor, action, detail)
  values (v_no, 'collector', 'login', jsonb_build_object('at', now()));

  return query select v_token, v_no, (v_no = 1);
end;
$$;

create or replace function public.vault_session(p_token text)
returns table (out_collector_no integer, out_is_owner boolean, out_expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rec record;
begin
  if p_token is null or length(btrim(p_token)) <> 64 then
    raise exception 'vault_access_denied';
  end if;

  select s.collector_no, s.expires_at into v_rec
  from public.vault_sessions s
  where s.token_hash = public.vault_hash_secret(p_token)
    and s.revoked_at is null
    and s.expires_at > now();

  if not found then
    raise exception 'vault_access_denied';
  end if;

  update public.vault_sessions set last_seen_at = now()
  where token_hash = public.vault_hash_secret(p_token);

  return query select v_rec.collector_no, (v_rec.collector_no = 1), v_rec.expires_at;
end;
$$;

create or replace function public.vault_logout(p_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.vault_sessions set revoked_at = now()
  where token_hash = public.vault_hash_secret(p_token) and revoked_at is null;
end;
$$;

create or replace function public.vault_assert_session(
  p_token text, p_owner_required boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rec record;
begin
  if p_token is null or length(btrim(p_token)) <> 64 then
    raise exception 'vault_access_denied';
  end if;

  select s.collector_no into v_rec
  from public.vault_sessions s
  where s.token_hash = public.vault_hash_secret(p_token)
    and s.revoked_at is null
    and s.expires_at > now();

  if not found then
    raise exception 'vault_access_denied';
  end if;
  if p_owner_required and v_rec.collector_no <> 1 then
    raise exception 'vault_owner_only';
  end if;
  return v_rec.collector_no;
end;
$$;

create or replace function public.vault_setup(
  p_setup_key text,
  p_owner_passkey text,
  p_collector2_passkey text
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_setup_key is distinct from current_setting('app.vault_setup_key', true) then
    raise exception 'vault_setup_denied';
  end if;
  if p_owner_passkey is null or length(btrim(p_owner_passkey)) < 10
     or p_collector2_passkey is null or length(btrim(p_collector2_passkey)) < 10 then
    raise exception 'vault_passkey_too_short';
  end if;

  update public.vault_access_config
  set passkey_hash = public.vault_hash_secret(btrim(p_owner_passkey)),
      setup_required = false,
      updated_at = now()
  where collector_no = 1;

  update public.vault_access_config
  set passkey_hash = public.vault_hash_secret(btrim(p_collector2_passkey)),
      setup_required = false,
      updated_at = now()
  where collector_no = 2;

  insert into public.vault_audit_log (collector_no, actor, action, detail)
  values (null, 'system', 'setup', jsonb_build_object('at', now()));

  return 'configured';
end;
$$;

revoke execute on function public.vault_setup(text, text, text) from public, anon, authenticated;
grant execute on function public.vault_setup(text, text, text) to service_role;

grant execute on function public.vault_login(text) to anon, authenticated;
grant execute on function public.vault_session(text) to anon, authenticated;
grant execute on function public.vault_logout(text) to anon, authenticated;

-- housekeeping (service_role only)
create or replace function public.vault_purge_expired_sessions()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_count integer;
begin
  delete from public.vault_sessions
  where expires_at < now() - interval '1 day' or revoked_at < now() - interval '1 day';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.vault_purge_expired_sessions() from public, anon, authenticated;
grant execute on function public.vault_purge_expired_sessions() to service_role;
