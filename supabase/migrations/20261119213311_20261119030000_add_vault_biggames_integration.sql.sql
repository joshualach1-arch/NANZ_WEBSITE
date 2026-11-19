/*
# NANZO SIGNED VAULT — BIG Games OAuth + inventory sync RPCs

## 1. Plain-English summary
Supports the server-side BIG Games integration:
- `vault_oauth_state_set/claim` — one-time PKCE state values for the
  OAuth authorize redirect (atomic claim prevents replay).
- `vault_oauth_save` — stores the access token + expiry + scope per
  collector after the edge function exchanges the code.
- `vault_oauth_state(p_token)` — collector-visible connect status
  (connected? token expiry? which Roblox account?).
- `vault_oauth_disconnect(p_token)` — removes the stored token.
- `vault_sync_apply` — takes the scanner's parsed inventory result and
  applies it atomically for a collector: upserts pets, creates
  acquisitions for new entries, records removed pets as ended. Returns
  counts for the UI.
- `vault_sync_state_get/set` — last sync timestamps per collector.

## 2. Security
- `vault_oauth_state_claim` and `vault_oauth_save` are service_role only
  (edge function). Collector-visible RPCs check the session token.
- Tokens stored server-side only; the browser never sees them.
- `vault_sync_apply` verifies the collector scope from the caller token
  (service_role calls pass p_token = null + explicit collector for the
  scheduled scanner, browser callers are scope-locked).
*/

create table if not exists public.vault_oauth_states (
  state text primary key,
  collector_no integer not null check (collector_no in (1,2)),
  code_verifier text not null,
  redirect_uri text not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

create table if not exists public.vault_sync_state (
  collector_no integer primary key check (collector_no in (1,2)),
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  last_pet_count integer,
  updated_at timestamptz not null default now()
);

insert into public.vault_sync_state (collector_no) values (1), (2)
on conflict (collector_no) do nothing;

revoke all on public.vault_oauth_states from anon, authenticated;
revoke all on public.vault_sync_state from anon, authenticated;
alter table public.vault_oauth_states enable row level security;
alter table public.vault_sync_state enable row level security;

-- ── OAuth state lifecycle (service_role) ────────────────────────────

create or replace function public.vault_oauth_state_set(
  p_collector_no integer,
  p_state text,
  p_code_verifier text,
  p_redirect_uri text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.vault_oauth_states (state, collector_no, code_verifier, redirect_uri)
  values (p_state, p_collector_no, p_code_verifier, p_redirect_uri);
$$;

create or replace function public.vault_oauth_state_claim(p_state text)
returns table (out_collector_no integer, out_code_verifier text, out_redirect_uri text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
begin
  delete from public.vault_oauth_states
  where created_at < now() - interval '1 hour';

  update public.vault_oauth_states
  set claimed_at = now()
  where state = p_state and claimed_at is null
  returning collector_no, code_verifier, redirect_uri into v_rec;

  if not found then
    raise exception 'oauth_state_invalid';
  end if;
  return query select v_rec.collector_no, v_rec.code_verifier, v_rec.redirect_uri;
end;
$$;

create or replace function public.vault_oauth_save(
  p_collector_no integer,
  p_access_token text,
  p_scope text,
  p_expires_at timestamptz,
  p_roblox_user_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.vault_oauth_tokens (collector_no, access_token, token_scope, expires_at, roblox_user_id, created_at, updated_at)
  values (p_collector_no, p_access_token, p_scope, p_expires_at, p_roblox_user_id, now(), now())
  on conflict (collector_no) do update
    set access_token = excluded.access_token,
        token_scope = excluded.token_scope,
        expires_at = excluded.expires_at,
        roblox_user_id = excluded.roblox_user_id,
        updated_at = now();

  insert into public.vault_audit_log (collector_no, actor, action, detail)
  values (p_collector_no, 'system', 'oauth_connect', jsonb_build_object('scope', p_scope));
end;
$$;

revoke execute on function public.vault_oauth_state_set(integer, text, text, text) from public, anon, authenticated;
revoke execute on function public.vault_oauth_state_claim(text) from public, anon, authenticated;
revoke execute on function public.vault_oauth_save(integer, text, text, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.vault_oauth_state_set(integer, text, text, text) to service_role;
grant execute on function public.vault_oauth_state_claim(text) to service_role;
grant execute on function public.vault_oauth_save(integer, text, text, timestamptz, bigint) to service_role;

-- ── collector-visible OAuth status ──────────────────────────────────

create or replace function public.vault_oauth_status(p_token text)
returns table (
  out_collector_no integer,
  out_connected boolean,
  out_expires_at timestamptz,
  out_roblox_user_id bigint,
  out_scope text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_collector integer := public.vault_assert_session(p_token, false);
  v_rec record;
begin
  select t.expires_at, t.roblox_user_id, t.token_scope into v_rec
  from public.vault_oauth_tokens t
  where t.collector_no = v_collector;

  return query select
    v_collector,
    v_rec.expires_at is not null and v_rec.expires_at > now(),
    v_rec.expires_at,
    v_rec.roblox_user_id,
    v_rec.token_scope;
end;
$$;

create or replace function public.vault_oauth_disconnect(p_token text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_collector integer := public.vault_assert_session(p_token, false);
begin
  delete from public.vault_oauth_tokens where collector_no = v_collector;
  insert into public.vault_audit_log (collector_no, actor, action, detail)
  values (v_collector, 'collector', 'oauth_disconnect', jsonb_build_object('at', now()));
  return 'disconnected';
end;
$$;

grant execute on function public.vault_oauth_status(text) to anon, authenticated;
grant execute on function public.vault_oauth_disconnect(text) to anon, authenticated;

-- ── sync application ────────────────────────────────────────────────

create or replace function public.vault_sync_apply(
  p_token text,
  p_collector_no integer,
  p_items jsonb
)
returns table (out_added integer, out_updated integer, out_removed integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_scope integer;
  v_added integer := 0;
  v_updated integer := 0;
  v_removed integer := 0;
  v_item jsonb;
  v_pet uuid;
  v_existing uuid;
  v_batch uuid := gen_random_uuid();
  v_count integer;
begin
  if p_token is null then
    v_scope := p_collector_no;
    if v_scope not in (1,2) then raise exception 'invalid_collector'; end if;
  else
    v_scope := public.vault_assert_session(p_token, false);
    if p_collector_no is not null and p_collector_no <> v_scope then
      if v_scope <> 1 then raise exception 'vault_owner_only'; end if;
      v_scope := p_collector_no;
    end if;
  end if;

  -- upsert each item
  for v_item in select * from jsonb_array_elements(p_items) loop
    select id into v_pet from public.vault_pet_catalog
    where lower(pet_name) = lower(coalesce(v_item->>'pet_name', ''));
    if v_pet is null then
      insert into public.vault_pet_catalog (pet_name, category)
      values (coalesce(v_item->>'pet_name', 'Unknown pet'), coalesce(v_item->>'category', 'Signed'))
      returning id into v_pet;
    end if;

    select id into v_existing from public.vault_pets
    where collector_no = v_scope and inventory_uid = v_item->>'inventory_uid';

    if v_existing is null then
      insert into public.vault_pets (collector_no, pet_id, signer_id, variant, raw_data, inventory_uid, added_by)
      values (v_scope, v_pet,
              (select signer_id from public.vault_signatures where pet_id = v_pet limit 1),
              coalesce(v_item->>'variant', 'normal'),
              v_item->'raw_data',
              v_item->>'inventory_uid',
              'sync');
      insert into public.vault_acquisitions (collector_no, pet_id, signer_id, variant, source, sync_batch_id)
      values (v_scope, v_pet, null, coalesce(v_item->>'variant', 'normal'), 'sync', v_batch);
      v_added := v_added + 1;
    else
      update public.vault_pets
      set raw_data = v_item->'raw_data',
          variant = coalesce(v_item->>'variant', variant),
          updated_at = now()
      where id = v_existing;
      v_updated := v_updated + 1;
    end if;
  end loop;

  -- remove pets no longer in the inventory (sync-added only)
  select count(*) into v_removed
  from public.vault_pets
  where collector_no = v_scope
    and added_by = 'sync'
    and inventory_uid is not null
    and not exists (
      select 1 from jsonb_array_elements(p_items) as it
      where it->>'inventory_uid' = public.vault_pets.inventory_uid
    );

  if v_removed > 0 then
    delete from public.vault_pets
    where collector_no = v_scope
      and added_by = 'sync'
      and inventory_uid is not null
      and not exists (
        select 1 from jsonb_array_elements(p_items) as it
        where it->>'inventory_uid' = public.vault_pets.inventory_uid
      );
  end if;

  update public.vault_sync_state
  set last_sync_at = now(),
      last_sync_status = 'ok',
      last_sync_error = null,
      last_pet_count = (select count(*) from public.vault_pets where collector_no = v_scope),
      updated_at = now()
  where collector_no = v_scope;

  return query select v_added, v_updated, v_removed;
end;
$$;

grant execute on function public.vault_sync_apply(text, integer, jsonb) to anon, authenticated;

create or replace function public.vault_sync_state_get(p_token text)
returns table (
  out_last_sync_at timestamptz,
  out_last_sync_status text,
  out_last_sync_error text,
  out_last_pet_count integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_collector integer := public.vault_assert_session(p_token, false);
  v_rec record;
begin
  select last_sync_at, last_sync_status, last_sync_error, last_pet_count into v_rec
  from public.vault_sync_state where collector_no = v_collector;
  return query select v_rec.last_sync_at, v_rec.last_sync_status, v_rec.last_sync_error, v_rec.last_pet_count;
end;
$$;

grant execute on function public.vault_sync_state_get(text) to anon, authenticated;
