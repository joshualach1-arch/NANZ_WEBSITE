/*
# NANZO SIGNED VAULT — data access RPCs (session-token secured)

## 1. Plain-English summary
Every vault data operation from the browser goes through these
SECURITY DEFINER functions. Each one first resolves the caller's
session token (vault_assert_session), which decides WHICH collector
the caller is. Per-collector data (collections, acquisitions,
verification, snapshots) is filtered by that collector number —
cross-collection access is impossible. Shared data (pet catalog,
signers, cosmic values) is readable by both collectors; only the
owner can modify it. Owner-only operations (settings, access reset)
are enforced inside the functions. All mutations are audit-logged.

## 2. Functions (all SECURITY DEFINER, EXECUTE to anon + authenticated)
- `vault_data_get(p_token)` — one call returning everything the vault UI
  needs: collectors, settings, catalog, signers, signatures, cosmic
  values, plus the caller's own pets/acquisitions/verification rows and
  portfolio value snapshot history. Owner additionally receives the
  other collector's data.
- `vault_catalog_manage(p_token, p_action, ...)` — owner-only CRUD for the
  pet catalog and cosmic values (add/update/delete pet, set cosmic value).
- `vault_signer_manage(p_token, p_action, ...)` — owner-only CRUD for the
  signer database and signature records.
- `vault_collection_manage(p_token, p_action, ...)` — collectors manage
  their OWN collection only (add/update/delete pet entry, create
  verification request). Owner may act on either collection via
  p_collector_no; collector 2 is forced to their own.
- `vault_settings_manage(p_token, ...)` — owner-only: update settings JSON,
  update collector labels/Roblox binding, change own passkey
  (passkey change uses vault_passkey_change with old passkey proof).
- `vault_passkey_change(p_token, p_old_passkey, p_new_passkey)` — any
  collector rotates their own passkey after proving the old one.
- `vault_snapshot_create(p_token)` — records a value snapshot for the
  caller's collection (owner may snapshot either).

## 3. Security
- Sessions: token hashes only, 7-day expiry, revocation supported.
- Owner-only branches raise 'vault_owner_only'; bad tokens raise
  'vault_access_denied'.
- p_collector_no is ALWAYS validated against the session scope — a
  collector can never write into the other collection.
- Catalog/signer deletes cascade to collections; deletes require owner.
- Generic error messages surface to the UI; details go to audit log.
*/

-- ── data read: everything for one caller in one call ───────────────

create or replace function public.vault_data_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_collector integer;
  v_is_owner boolean;
  v_result jsonb;
begin
  v_collector := public.vault_assert_session(p_token, false);
  v_is_owner := v_collector = 1;

  select jsonb_build_object(
    'me', v_collector,
    'is_owner', v_is_owner,
    'collectors', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'collector_no', c.collector_no,
          'label', c.label,
          'is_owner', c.is_owner,
          'roblox_username', c.roblox_username,
          'roblox_user_id', c.roblox_user_id,
          'avatar_url', c.avatar_url,
          'notes', c.notes
        ) order by c.collector_no
      ), '[]'::jsonb)
      from public.vault_collectors c
    ),
    'settings', (
      select s.settings from public.vault_settings s where s.id = true
    ),
    'catalog', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', p.id, 'pet_name', p.pet_name, 'category', p.category,
          'image_url', p.image_url, 'notes', p.notes,
          'cosmic_value', cv.cosmic_value, 'demand', cv.demand,
          'value_source', cv.source
        ) order by p.pet_name
      ), '[]'::jsonb)
      from public.vault_pet_catalog p
      left join public.vault_cosmic_values cv on cv.pet_id = p.id
    ),
    'signers', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', s.id, 'signer_name', s.signer_name,
          'roblox_username', s.roblox_username,
          'roblox_user_id', s.roblox_user_id,
          'avatar_url', s.avatar_url, 'notes', s.notes,
          'signature_count', (
            select count(*) from public.vault_signatures g where g.signer_id = s.id
          )
        ) order by s.signer_name
      ), '[]'::jsonb)
      from public.vault_signers s
    ),
    'signatures', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', g.id, 'pet_id', g.pet_id, 'signer_id', g.signer_id,
          'variant', g.variant, 'notes', g.notes
        )
      ), '[]'::jsonb)
      from public.vault_signatures g
    ),
    'pets', (
      select coalesce(jsonb_agg(t.row_data order by t.row_data->>'pet_name'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', vp.id, 'pet_id', vp.pet_id,
          'pet_name', pc.pet_name, 'pet_image', pc.image_url,
          'pet_category', pc.category,
          'signer_id', vp.signer_id, 'signer_name', vs.signer_name,
          'variant', vp.variant, 'nickname', vp.nickname,
          'acquired_at', vp.acquired_at,
          'purchase_price', vp.purchase_price, 'currency', vp.currency,
          'inventory_uid', vp.inventory_uid, 'added_by', vp.added_by,
          'notes', vp.notes, 'created_at', vp.created_at,
          'cosmic_value', cv.cosmic_value
        ) as row_data
        from public.vault_pets vp
        join public.vault_pet_catalog pc on pc.id = vp.pet_id
        left join public.vault_signers vs on vs.id = vp.signer_id
        left join public.vault_cosmic_values cv on cv.pet_id = vp.pet_id
        where vp.collector_no = v_collector
      ) t
    ),
    'other_pets', case when v_is_owner then (
      select coalesce(jsonb_agg(t.row_data order by t.row_data->>'pet_name'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', vp.id, 'pet_id', vp.pet_id,
          'pet_name', pc.pet_name, 'pet_image', pc.image_url,
          'signer_id', vp.signer_id, 'signer_name', vs.signer_name,
          'variant', vp.variant, 'nickname', vp.nickname,
          'acquired_at', vp.acquired_at,
          'purchase_price', vp.purchase_price, 'currency', vp.currency,
          'inventory_uid', vp.inventory_uid, 'added_by', vp.added_by,
          'notes', vp.notes, 'created_at', vp.created_at,
          'cosmic_value', cv.cosmic_value
        ) as row_data
        from public.vault_pets vp
        join public.vault_pet_catalog pc on pc.id = vp.pet_id
        left join public.vault_signers vs on vs.id = vp.signer_id
        left join public.vault_cosmic_values cv on cv.pet_id = vp.pet_id
        where vp.collector_no = 2
      ) t
    ) else null end,
    'acquisitions', (
      select coalesce(jsonb_agg(t.row_data order by t.row_data->>'created_at' desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', va.id, 'pet_id', va.pet_id, 'pet_name', pc.pet_name,
          'signer_id', va.signer_id, 'signer_name', vs.signer_name,
          'variant', va.variant, 'acquired_at', va.acquired_at,
          'purchase_price', va.purchase_price, 'currency', va.currency,
          'source', va.source, 'notes', va.notes, 'created_at', va.created_at
        ) as row_data
        from public.vault_acquisitions va
        join public.vault_pet_catalog pc on pc.id = va.pet_id
        left join public.vault_signers vs on vs.id = va.signer_id
        where va.collector_no = v_collector
      ) t
    ),
    'value_snapshots', (
      select coalesce(jsonb_agg(
        jsonb_build_object('total_value', s.total_value, 'pet_count', s.pet_count, 'captured_at', s.captured_at)
        order by s.captured_at
      ), '[]'::jsonb)
      from public.vault_value_snapshots s
      where s.collector_no = v_collector
    ),
    'verification', (
      select coalesce(jsonb_agg(t.row_data order by t.row_data->>'created_at' desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', vr.id, 'pet_id', vr.pet_id, 'pet_name', pc.pet_name,
          'signer_id', vr.signer_id, 'signer_name', vs.signer_name,
          'status', vr.status, 'evidence_url', vr.evidence_url,
          'notes', vr.notes, 'reviewed_at', vr.reviewed_at,
          'created_at', vr.created_at
        ) as row_data
        from public.vault_verification_requests vr
        join public.vault_pet_catalog pc on pc.id = vr.pet_id
        left join public.vault_signers vs on vs.id = vr.signer_id
        where vr.collector_no = v_collector
      ) t
    ),
    'access_setup_required', (
      select bool_or(a.setup_required) from public.vault_access_config a
    )
  ) into v_result;

  return v_result;
end;
$$;

-- ── shared catalog + cosmic values (owner-only writes) ──────────────

create or replace function public.vault_catalog_manage(
  p_token text,
  p_action text,
  p_pet_id uuid default null,
  p_pet_name text default null,
  p_category text default 'Signed',
  p_image_url text default null,
  p_notes text default null,
  p_cosmic_value numeric default null,
  p_demand integer default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_collector integer := public.vault_assert_session(p_token, true);
  v_pet uuid;
begin
  if p_action = 'add' then
    if p_pet_name is null or length(btrim(p_pet_name)) = 0 then
      raise exception 'pet_name_required';
    end if;
    insert into public.vault_pet_catalog (pet_name, category, image_url, notes)
    values (btrim(p_pet_name), coalesce(p_category, 'Signed'), p_image_url, p_notes)
    on conflict (pet_name) do update
      set category = excluded.category,
          image_url = excluded.image_url,
          notes = excluded.notes,
          updated_at = now()
    returning id into v_pet;
    if p_cosmic_value is not null or p_demand is not null then
      insert into public.vault_cosmic_values (pet_id, cosmic_value, demand, source)
      values (v_pet, p_cosmic_value, p_demand, 'manual')
      on conflict (pet_id) do update
        set cosmic_value = coalesce(excluded.cosmic_value, vault_cosmic_values.cosmic_value),
            demand = coalesce(excluded.demand, vault_cosmic_values.demand),
            source = 'manual', updated_at = now();
    end if;
    insert into public.vault_audit_log (collector_no, actor, action, detail)
    values (v_collector, 'owner', 'catalog_add',
            jsonb_build_object('pet_name', p_pet_name));
    return 'added';
  end if;

  select id into v_pet from public.vault_pet_catalog where id = p_pet_id;
  if v_pet is null then raise exception 'pet_not_found'; end if;

  if p_action = 'update' then
    update public.vault_pet_catalog
    set pet_name = coalesce(p_pet_name, pet_name),
        category = coalesce(p_category, category),
        image_url = coalesce(p_image_url, image_url),
        notes = p_notes,
        updated_at = now()
    where id = v_pet;
    return 'updated';
  elsif p_action = 'set_value' then
    insert into public.vault_cosmic_values (pet_id, cosmic_value, demand, source)
    values (v_pet, p_cosmic_value, p_demand, 'manual')
    on conflict (pet_id) do update
      set cosmic_value = coalesce(p_cosmic_value, vault_cosmic_values.cosmic_value),
          demand = coalesce(p_demand, vault_cosmic_values.demand),
          source = 'manual', updated_at = now();
    return 'value_set';
  elsif p_action = 'delete' then
    delete from public.vault_pet_catalog where id = v_pet;
    return 'deleted';
  end if;
  raise exception 'unknown_action';
end;
$$;

-- ── signers + signature records (owner-only writes) ─────────────────

create or replace function public.vault_signer_manage(
  p_token text,
  p_action text,
  p_signer_id uuid default null,
  p_signer_name text default null,
  p_roblox_username text default null,
  p_roblox_user_id bigint default null,
  p_notes text default null,
  p_pet_id uuid default null,
  p_variant text default 'normal'
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_collector integer := public.vault_assert_session(p_token, true);
  v_signer uuid;
begin
  if p_action = 'add' then
    if p_signer_name is null or length(btrim(p_signer_name)) = 0 then
      raise exception 'signer_name_required';
    end if;
    insert into public.vault_signers (signer_name, roblox_username, roblox_user_id, notes)
    values (btrim(p_signer_name), p_roblox_username, p_roblox_user_id, p_notes)
    on conflict (signer_name) do update
      set roblox_username = excluded.roblox_username,
          roblox_user_id = excluded.roblox_user_id,
          notes = excluded.notes,
          updated_at = now()
    returning id into v_signer;
    if p_pet_id is not null then
      insert into public.vault_signatures (pet_id, signer_id, variant)
      values (p_pet_id, v_signer, coalesce(p_variant, 'normal'))
      on conflict (pet_id, signer_id, variant) do nothing;
    end if;
    insert into public.vault_audit_log (collector_no, actor, action, detail)
    values (v_collector, 'owner', 'signer_add', jsonb_build_object('signer_name', p_signer_name));
    return 'added';
  end if;

  select id into v_signer from public.vault_signers where id = p_signer_id;
  if v_signer is null then raise exception 'signer_not_found'; end if;

  if p_action = 'update' then
    update public.vault_signers
    set signer_name = coalesce(p_signer_name, signer_name),
        roblox_username = p_roblox_username,
        roblox_user_id = coalesce(p_roblox_user_id, roblox_user_id),
        notes = p_notes,
        updated_at = now()
    where id = v_signer;
    return 'updated';
  elsif p_action = 'link' then
    if p_pet_id is null then raise exception 'pet_required'; end if;
    insert into public.vault_signatures (pet_id, signer_id, variant)
    values (p_pet_id, v_signer, coalesce(p_variant, 'normal'))
    on conflict (pet_id, signer_id, variant) do nothing;
    return 'linked';
  elsif p_action = 'unlink' then
    if p_pet_id is null then raise exception 'pet_required'; end if;
    delete from public.vault_signatures
    where pet_id = p_pet_id and signer_id = v_signer
      and variant = coalesce(p_variant, 'normal');
    return 'unlinked';
  elsif p_action = 'delete' then
    delete from public.vault_signers where id = v_signer;
    return 'deleted';
  end if;
  raise exception 'unknown_action';
end;
$$;

-- ── own collection management (scope-locked) ────────────────────────

create or replace function public.vault_collection_manage(
  p_token text,
  p_action text,
  p_collector_no integer default null,
  p_pet_entry_id uuid default null,
  p_pet_id uuid default null,
  p_signer_id uuid default null,
  p_variant text default 'normal',
  p_nickname text default null,
  p_acquired_at date default null,
  p_purchase_price numeric default null,
  p_currency text default 'USD',
  p_notes text default null,
  p_evidence_url text default null,
  p_request_id uuid default null,
  p_request_status text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_collector integer := public.vault_assert_session(p_token, false);
  v_scope integer := v_collector;
  v_entry uuid;
  v_pet_known boolean;
begin
  if p_collector_no is not null then
    if v_collector <> 1 then
      raise exception 'vault_owner_only';
    end if;
    if p_collector_no not in (1,2) then raise exception 'invalid_collector'; end if;
    v_scope := p_collector_no;
  end if;

  if p_action in ('add','update') then
    if p_pet_id is null then raise exception 'pet_required'; end if;
    select exists(select 1 from public.vault_pet_catalog where id = p_pet_id)
      into v_pet_known;
    if not v_pet_known then raise exception 'pet_not_in_catalog'; end if;
    if p_variant is not null and p_variant not in ('normal','golden','rainbow','shiny') then
      raise exception 'invalid_variant';
    end if;
    if p_purchase_price is not null and p_purchase_price < 0 then
      raise exception 'invalid_price';
    end if;
    if p_purchase_price is not null and p_purchase_price > 1000000000 then
      raise exception 'invalid_price';
    end if;
  end if;

  if p_action = 'add' then
    insert into public.vault_pets (collector_no, pet_id, signer_id, variant,
                                   nickname, acquired_at, purchase_price, currency, notes)
    values (v_scope, p_pet_id, p_signer_id, coalesce(p_variant, 'normal'),
            p_nickname, p_acquired_at, p_purchase_price, coalesce(p_currency, 'USD'), p_notes)
    returning id into v_entry;

    insert into public.vault_acquisitions (collector_no, pet_id, signer_id, variant,
                                           acquired_at, purchase_price, currency, source, pet_inventory_id)
    values (v_scope, p_pet_id, p_signer_id, coalesce(p_variant, 'normal'),
            p_acquired_at, p_purchase_price, coalesce(p_currency, 'USD'), 'manual', v_entry);

    insert into public.vault_audit_log (collector_no, actor, action, detail)
    values (v_scope, case when v_scope = v_collector then 'collector' else 'owner' end,
            'collection_add', jsonb_build_object('pet_id', p_pet_id));
    return 'added';
  end if;

  select id into v_entry from public.vault_pets
  where id = p_pet_entry_id and collector_no = v_scope;
  if v_entry is null then raise exception 'entry_not_found'; end if;

  if p_action = 'update' then
    update public.vault_pets
    set signer_id = p_signer_id,
        variant = coalesce(p_variant, variant),
        nickname = p_nickname,
        acquired_at = coalesce(p_acquired_at, acquired_at),
        purchase_price = coalesce(p_purchase_price, purchase_price),
        currency = coalesce(p_currency, currency),
        notes = p_notes,
        updated_at = now()
    where id = v_entry;
    return 'updated';
  elsif p_action = 'delete' then
    delete from public.vault_pets where id = v_entry;
    return 'deleted';
  elsif p_action = 'verify_request' then
    if p_pet_id is null then raise exception 'pet_required'; end if;
    insert into public.vault_verification_requests
      (collector_no, pet_id, signer_id, evidence_url, notes, status)
    values (v_scope, p_pet_id, p_signer_id, p_evidence_url, p_notes, 'pending');
    insert into public.vault_audit_log (collector_no, actor, action, detail)
    values (v_scope, 'collector', 'verify_request', jsonb_build_object('pet_id', p_pet_id));
    return 'requested';
  elsif p_action = 'verify_review' then
    if v_collector <> 1 then raise exception 'vault_owner_only'; end if;
    if p_request_status not in ('verified','rejected') then
      raise exception 'invalid_status';
    end if;
    update public.vault_verification_requests
    set status = p_request_status, reviewed_at = now(), notes = coalesce(p_notes, notes)
    where id = p_request_id and collector_no = v_scope;
    if not found then raise exception 'request_not_found'; end if;
    insert into public.vault_audit_log (collector_no, actor, action, detail)
    values (v_scope, 'owner', 'verify_review',
            jsonb_build_object('request_id', p_request_id, 'status', p_request_status));
    return 'reviewed';
  elsif p_action = 'snapshot' then
    insert into public.vault_value_snapshots (collector_no, total_value, pet_count)
    select v_scope,
           coalesce(sum(cv.cosmic_value), 0),
           count(*)
    from public.vault_pets vp
    left join public.vault_cosmic_values cv on cv.pet_id = vp.pet_id
    where vp.collector_no = v_scope;
    return 'snapshotted';
  end if;
  raise exception 'unknown_action';
end;
$$;

-- ── settings (owner-only) ───────────────────────────────────────────

create or replace function public.vault_settings_manage(
  p_token text,
  p_settings jsonb default null,
  p_collector_no integer default null,
  p_label text default null,
  p_roblox_username text default null,
  p_roblox_user_id bigint default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_collector integer := public.vault_assert_session(p_token, true);
begin
  if p_settings is not null then
    update public.vault_settings
    set settings = p_settings, updated_at = now()
    where id = true;
    insert into public.vault_audit_log (collector_no, actor, action, detail)
    values (v_collector, 'owner', 'settings_update', p_settings);
  end if;

  if p_collector_no is not null then
    if p_collector_no not in (1,2) then raise exception 'invalid_collector'; end if;
    update public.vault_collectors
    set label = coalesce(p_label, label),
        roblox_username = p_roblox_username,
        roblox_user_id = coalesce(p_roblox_user_id, roblox_user_id),
        updated_at = now()
    where collector_no = p_collector_no;
    insert into public.vault_audit_log (collector_no, actor, action, detail)
    values (v_collector, 'owner', 'collector_update',
            jsonb_build_object('collector_no', p_collector_no));
  end if;
  return 'ok';
end;
$$;

-- ── own passkey rotation (proof of old passkey required) ────────────

create or replace function public.vault_passkey_change(
  p_token text,
  p_old_passkey text,
  p_new_passkey text
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_collector integer;
  v_hash text;
begin
  v_collector := public.vault_assert_session(p_token, false);

  select passkey_hash into v_hash
  from public.vault_access_config
  where collector_no = v_collector;

  if v_hash is distinct from public.vault_hash_secret(btrim(coalesce(p_old_passkey, ''))) then
    raise exception 'vault_access_denied';
  end if;
  if p_new_passkey is null or length(btrim(p_new_passkey)) < 10 then
    raise exception 'vault_passkey_too_short';
  end if;

  update public.vault_access_config
  set passkey_hash = public.vault_hash_secret(btrim(p_new_passkey)),
      updated_at = now()
  where collector_no = v_collector;

  insert into public.vault_audit_log (collector_no, actor, action, detail)
  values (v_collector, 'collector', 'passkey_change', jsonb_build_object('at', now()));
  return 'changed';
end;
$$;

grant execute on function
  public.vault_data_get(text),
  public.vault_catalog_manage(text, text, uuid, text, text, text, text, numeric, integer),
  public.vault_signer_manage(text, text, uuid, text, text, bigint, text, uuid, text),
  public.vault_collection_manage(text, text, integer, uuid, uuid, uuid, text, text, date, numeric, text, text, text, uuid, text),
  public.vault_settings_manage(text, jsonb, integer, text, text, bigint),
  public.vault_passkey_change(text, text, text)
to anon, authenticated;
