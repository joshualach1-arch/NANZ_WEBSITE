/*
# NANZO SIGNED VAULT — Task 04: inventory scanner, signed detection,
# acquisition history, collection checklist

1. New Tables
- `vault_inventory_items` — one row per detected inventory instance or stack (full fidelity).
- `vault_inventory_snapshots` — one row per sync run (collector, roblox account, sync id,
  started/completed, status, counts, error details).
- `vault_notifications` — stored new-acquisition notification state (dedupe key per collector).
- `vault_acquisition_corrections` — audit trail of manual acquisition corrections.

2. Modified Tables
- `vault_pets`: variant CHECK widened; new instance_id, stack_key, quantity, signed_status,
  verification_status, signature_data, last_seen_at.
- `vault_acquisitions`: variant + source CHECKs widened; new acquisition_type,
  signature_value_at_acquisition, current_value, verification_status, updated_at/updated_by.

3. New Functions (SECURITY DEFINER, search_path pinned)
- `vault_inventory_apply(...)` — service_role. Scanner core (see header comment in code).
- `vault_snapshot_start` / `vault_snapshot_fail` — service_role snapshot lifecycle.
- `vault_scanner_data_get(p_token, p_collector_no)` — session-scoped scanner data read.
- `vault_notifications_manage` — dismiss (session-scoped).
- `vault_acquisition_manage` — manual corrections with full change logging.
- `vault_checklist_get` — collection checklist (catalog signability + owned verification).
- `vault_notification_add` — service_role, dedupe-protected.

4. Security
- All new tables: RLS enabled, REVOKE ALL from anon/authenticated (vault deny-all pattern).
*/

-- ── variant domain widening (existing rows keep their value) ───────

ALTER TABLE vault_pets DROP CONSTRAINT vault_pets_variant_check;
ALTER TABLE vault_pets ADD CONSTRAINT vault_pets_variant_check
  CHECK (variant IN ('normal','golden','rainbow','shiny','rainbow_shiny','other'));

ALTER TABLE vault_acquisitions DROP CONSTRAINT vault_acquisitions_source_check;

ALTER TABLE vault_pets
  ADD COLUMN IF NOT EXISTS instance_id text,
  ADD COLUMN IF NOT EXISTS stack_key text,
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS signed_status text NOT NULL DEFAULT 'manual_review'
    CHECK (signed_status IN ('verified','unverified','not_signed','manual_review')),
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'needs_review'
    CHECK (verification_status IN ('verified','community_verified','unverified','needs_review')),
  ADD COLUMN IF NOT EXISTS signature_data jsonb,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS vault_pets_collector_uid_idx ON vault_pets (collector_no, inventory_uid);

ALTER TABLE vault_acquisitions
  ADD COLUMN IF NOT EXISTS acquisition_type text NOT NULL DEFAULT 'unconfirmed'
    CHECK (acquisition_type IN ('booth_purchase','trade','auction','giveaway','gift','manual_addition','other','unconfirmed','sync')),
  ADD COLUMN IF NOT EXISTS signature_value_at_acquisition numeric,
  ADD COLUMN IF NOT EXISTS current_value numeric,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('verified','community_verified','unverified','needs_review')),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by text;

ALTER TABLE vault_acquisitions ADD CONSTRAINT vault_acquisitions_source_check
  CHECK (source IN ('manual','sync','trade','gift','booth_purchase','auction','giveaway','other','unconfirmed'));

-- ── new tables ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vault_inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_no smallint NOT NULL CHECK (collector_no IN (1,2)),
  roblox_user_id bigint,
  external_pet_id text,
  pet_id uuid REFERENCES vault_pet_catalog(id) ON DELETE SET NULL,
  pet_name text NOT NULL,
  category text,
  variant text NOT NULL DEFAULT 'normal',
  is_golden boolean NOT NULL DEFAULT false,
  is_rainbow boolean NOT NULL DEFAULT false,
  is_shiny boolean NOT NULL DEFAULT false,
  is_rainbow_shiny boolean NOT NULL DEFAULT false,
  stack_key text,
  quantity integer NOT NULL DEFAULT 1,
  instance_id text,
  inventory_uid text NOT NULL,
  signature_data jsonb,
  signer_id uuid REFERENCES vault_signers(id) ON DELETE SET NULL,
  signed_status text NOT NULL DEFAULT 'manual_review'
    CHECK (signed_status IN ('verified','unverified','not_signed','manual_review')),
  verification_status text NOT NULL DEFAULT 'needs_review'
    CHECK (verification_status IN ('verified','community_verified','unverified','needs_review')),
  owner_label text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  present boolean NOT NULL DEFAULT true,
  data_source text NOT NULL DEFAULT 'biggames_oauth',
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collector_no, inventory_uid)
);

CREATE INDEX IF NOT EXISTS vault_inventory_items_collector_idx
  ON vault_inventory_items (collector_no, present, pet_id);

CREATE TABLE IF NOT EXISTS vault_inventory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_id uuid,
  collector_no smallint NOT NULL CHECK (collector_no IN (1,2)),
  roblox_user_id bigint,
  status text NOT NULL CHECK (status IN ('running','complete','failed','partial')),
  pet_count integer NOT NULL DEFAULT 0,
  added integer NOT NULL DEFAULT 0,
  removed integer NOT NULL DEFAULT 0,
  changed integer NOT NULL DEFAULT 0,
  acquisitions_detected integer NOT NULL DEFAULT 0,
  error_code text,
  error_details jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS vault_inventory_snapshots_collector_idx
  ON vault_inventory_snapshots (collector_no, started_at DESC);

CREATE TABLE IF NOT EXISTS vault_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_no smallint NOT NULL CHECK (collector_no IN (1,2)),
  kind text NOT NULL DEFAULT 'new_acquisition',
  pet_id uuid,
  pet_entry_id uuid,
  title text NOT NULL,
  body_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  dedupe_key text NOT NULL,
  shown_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  UNIQUE (collector_no, dedupe_key)
);

CREATE TABLE IF NOT EXISTS vault_acquisition_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acquisition_id uuid NOT NULL REFERENCES vault_acquisitions(id) ON DELETE CASCADE,
  collector_no smallint NOT NULL CHECK (collector_no IN (1,2)),
  changed_fields jsonb NOT NULL,
  changed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── lockdown ───────────────────────────────────────────────────────

ALTER TABLE vault_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_inventory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_acquisition_corrections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON vault_inventory_items FROM anon, authenticated;
REVOKE ALL ON vault_inventory_snapshots FROM anon, authenticated;
REVOKE ALL ON vault_notifications FROM anon, authenticated;
REVOKE ALL ON vault_acquisition_corrections FROM anon, authenticated;

-- ── scanner apply (service_role only, called from vault-biggames) ──

CREATE OR REPLACE FUNCTION vault_inventory_apply(
  p_collector_no smallint,
  p_items jsonb,
  p_sync_id uuid,
  p_roblox_user_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_added integer := 0;
  v_updated integer := 0;
  v_removed integer := 0;
  v_acq integer := 0;
  v_item jsonb;
  v_pet uuid;
  v_existing uuid;
  v_existing_signed text;
  v_uid text;
  v_signed text;
  v_verif text;
  v_variant text;
  v_signer uuid;
  v_sig_signer uuid;
  v_snapshot uuid;
  v_new_entry uuid;
BEGIN
  IF p_collector_no NOT IN (1,2) THEN RAISE EXCEPTION 'vault_invalid_collector'; END IF;

  SELECT id INTO v_snapshot FROM vault_inventory_snapshots
   WHERE sync_id = p_sync_id AND collector_no = p_collector_no;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_uid := v_item->>'inventory_uid';
    IF v_uid IS NULL OR length(v_uid) = 0 THEN
      v_uid := 'anon:' || md5(v_item::text);
    END IF;
    v_variant := coalesce(v_item->>'variant', 'normal');

    -- catalog match: external id first, then exact name
    SELECT id INTO v_pet FROM vault_pet_catalog
     WHERE (v_item->>'external_pet_id' IS NOT NULL AND external_id = v_item->>'external_pet_id')
        OR lower(pet_name) = lower(coalesce(v_item->>'pet_name',''));

    v_signed := coalesce(v_item->>'signed_status', 'manual_review');
    v_verif := CASE
      WHEN v_signed = 'verified' THEN 'verified'
      ELSE 'unverified'
    END;

    -- signer resolution: ONLY reliable identifiers from the source
    v_signer := NULL;
    IF v_item->>'signer_id' IS NOT NULL THEN
      SELECT id INTO v_signer FROM vault_signers
       WHERE roblox_user_id = (v_item->>'signer_id')::bigint
          OR id::text = v_item->>'signer_id'
       LIMIT 1;
    END IF;
    -- verified signature evidence in the shared signature database
    IF v_signer IS NULL AND v_pet IS NOT NULL AND v_signed <> 'not_signed' THEN
      SELECT g.signer_id INTO v_sig_signer
        FROM vault_signatures g
       WHERE g.pet_id = v_pet
         AND g.verification_status IN ('verified','community_verified')
       ORDER BY (g.verification_status = 'verified') DESC, g.updated_at DESC NULLS LAST
       LIMIT 1;
      IF v_sig_signer IS NOT NULL THEN
        v_signer := v_sig_signer;
        IF v_signed = 'manual_review' THEN v_signed := 'verified'; END IF;
        v_verif := 'verified';
      END IF;
    END IF;

    SELECT id, signed_status INTO v_existing, v_existing_signed
      FROM vault_pets WHERE collector_no = p_collector_no AND inventory_uid = v_uid;

    IF v_existing IS NULL THEN
      INSERT INTO vault_pets
        (collector_no, pet_id, signer_id, variant, raw_data, inventory_uid, added_by,
         instance_id, stack_key, quantity, signed_status, verification_status, signature_data,
         last_seen_at, notes)
      VALUES
        (p_collector_no, v_pet, v_signer, v_variant,
         v_item->'raw_data', v_uid, 'sync',
         v_item->>'instance_id', v_item->>'stack_key',
         coalesce((v_item->>'quantity')::int, 1),
         v_signed, v_verif, v_item->'signature_data', now(),
         CASE WHEN coalesce((v_item->>'quantity')::int, 1) > 1
              THEN 'Stack of ' || (v_item->>'quantity')::int ELSE NULL END)
      RETURNING id INTO v_new_entry;
      v_added := v_added + 1;

      -- acquisition detection: only clear additions create UNCONFIRMED events (Part 5)
      INSERT INTO vault_acquisitions
        (collector_no, pet_id, signer_id, variant, acquired_at, source, acquisition_type,
         sync_batch_id, pet_inventory_id, purchase_price, currency, verification_status, notes)
      VALUES
        (p_collector_no, v_pet, v_signer, v_variant,
         CURRENT_DATE, 'sync', 'unconfirmed', p_sync_id, v_new_entry,
         NULL, 'USD', 'unverified',
         'Detected via inventory scan. Purchase price: not available.');
      v_acq := v_acq + 1;
    ELSE
      UPDATE vault_pets SET
        pet_id = coalesce(v_pet, pet_id),
        signer_id = CASE WHEN v_signer IS NOT NULL THEN v_signer ELSE signer_id END,
        instance_id = coalesce(v_item->>'instance_id', instance_id),
        stack_key = coalesce(v_item->>'stack_key', stack_key),
        quantity = coalesce((v_item->>'quantity')::int, quantity),
        signed_status = CASE
          WHEN v_signed = 'not_signed' AND v_existing_signed IN ('verified','unverified') THEN v_existing_signed
          ELSE v_signed END,
        verification_status = CASE
          WHEN v_verif = 'verified' THEN 'verified'
          ELSE verification_status END,
        signature_data = coalesce(v_item->'signature_data', signature_data),
        last_seen_at = now(),
        updated_at = now()
      WHERE id = v_existing;
      v_updated := v_updated + 1;
    END IF;

    -- full-fidelity inventory item upsert
    INSERT INTO vault_inventory_items
      (collector_no, roblox_user_id, external_pet_id, pet_id, pet_name, category, variant,
       is_golden, is_rainbow, is_shiny, is_rainbow_shiny, stack_key, quantity, instance_id,
       inventory_uid, signature_data, signer_id, signed_status, verification_status,
       owner_label, present, data_source, raw_data, first_seen_at, last_seen_at)
    VALUES
      (p_collector_no, p_roblox_user_id, v_item->>'external_pet_id', v_pet,
       coalesce(v_item->>'pet_name','Unknown pet'), v_item->>'category', v_variant,
       coalesce((v_item->>'is_golden')::boolean, v_variant = 'golden'),
       coalesce((v_item->>'is_rainbow')::boolean, v_variant = 'rainbow'),
       coalesce((v_item->>'is_shiny')::boolean, v_variant = 'shiny'),
       coalesce((v_item->>'is_rainbow_shiny')::boolean, v_variant = 'rainbow_shiny'),
       v_item->>'stack_key', coalesce((v_item->>'quantity')::int, 1), v_item->>'instance_id',
       v_uid, v_item->'signature_data', v_signer, v_signed, v_verif,
       v_item->>'owner_label', true, 'biggames_oauth', v_item->'raw_data', now(), now())
    ON CONFLICT (collector_no, inventory_uid) DO UPDATE SET
      external_pet_id = coalesce(excluded.external_pet_id, vault_inventory_items.external_pet_id),
      pet_id = coalesce(excluded.pet_id, vault_inventory_items.pet_id),
      pet_name = excluded.pet_name,
      category = coalesce(excluded.category, vault_inventory_items.category),
      variant = excluded.variant,
      is_golden = excluded.is_golden,
      is_rainbow = excluded.is_rainbow,
      is_shiny = excluded.is_shiny,
      is_rainbow_shiny = excluded.is_rainbow_shiny,
      stack_key = coalesce(excluded.stack_key, vault_inventory_items.stack_key),
      quantity = excluded.quantity,
      instance_id = coalesce(excluded.instance_id, vault_inventory_items.instance_id),
      signature_data = coalesce(excluded.signature_data, vault_inventory_items.signature_data),
      signer_id = CASE WHEN excluded.signer_id IS NOT NULL THEN excluded.signer_id
                       ELSE vault_inventory_items.signer_id END,
      signed_status = CASE
        WHEN excluded.signed_status = 'not_signed' AND vault_inventory_items.signed_status IN ('verified','unverified')
        THEN vault_inventory_items.signed_status ELSE excluded.signed_status END,
      verification_status = CASE
        WHEN excluded.verification_status = 'verified' THEN 'verified'
        ELSE vault_inventory_items.verification_status END,
      present = true,
      last_seen_at = now(),
      updated_at = now();
  END LOOP;

  -- removals: sync-managed rows no longer in this scan
  SELECT count(*) INTO v_removed
    FROM vault_pets
   WHERE collector_no = p_collector_no AND added_by = 'sync' AND inventory_uid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) it WHERE it->>'inventory_uid' = vault_pets.inventory_uid);

  IF v_removed > 0 THEN
    UPDATE vault_inventory_items SET present = false, updated_at = now()
     WHERE collector_no = p_collector_no AND present
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) it WHERE it->>'inventory_uid' = vault_inventory_items.inventory_uid);
    DELETE FROM vault_pets
     WHERE collector_no = p_collector_no AND added_by = 'sync' AND inventory_uid IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) it WHERE it->>'inventory_uid' = vault_pets.inventory_uid);
  END IF;

  -- finalize the snapshot for this run
  UPDATE vault_inventory_snapshots SET
    status = 'complete',
    pet_count = (SELECT coalesce(sum(quantity), 0) FROM vault_pets WHERE collector_no = p_collector_no),
    added = v_added, removed = v_removed, changed = v_updated,
    acquisitions_detected = v_acq,
    completed_at = now()
  WHERE id = v_snapshot;

  -- collection statistics snapshot (value tracking continuity)
  INSERT INTO vault_value_snapshots (collector_no, total_value, pet_count)
  SELECT p_collector_no, coalesce(sum(cv.cosmic_value * vp.quantity), 0), count(*)
    FROM vault_pets vp
    LEFT JOIN vault_cosmic_values cv ON cv.pet_id = vp.pet_id
   WHERE vp.collector_no = p_collector_no;

  UPDATE vault_sync_state SET
    last_sync_at = now(), last_sync_status = 'ok', last_sync_error = NULL,
    last_pet_count = (SELECT count(*) FROM vault_pets WHERE collector_no = p_collector_no),
    updated_at = now()
  WHERE collector_no = p_collector_no;

  RETURN jsonb_build_object('added', v_added, 'updated', v_updated, 'removed', v_removed,
                            'acquisitions', v_acq);
END;
$$;

REVOKE ALL ON FUNCTION vault_inventory_apply(smallint, jsonb, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault_inventory_apply(smallint, jsonb, uuid, bigint) TO service_role;

-- ── snapshot lifecycle (service_role) ──────────────────────────────

CREATE OR REPLACE FUNCTION vault_snapshot_start(
  p_collector_no smallint,
  p_sync_id uuid,
  p_roblox_user_id bigint DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_collector_no NOT IN (1,2) THEN RAISE EXCEPTION 'vault_invalid_collector'; END IF;
  INSERT INTO vault_inventory_snapshots (sync_id, collector_no, roblox_user_id, status, started_at)
  VALUES (p_sync_id, p_collector_no, p_roblox_user_id, 'running', now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION vault_snapshot_fail(
  p_sync_id uuid,
  p_collector_no smallint,
  p_error_code text,
  p_error_details jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  UPDATE vault_inventory_snapshots SET
    status = 'failed', error_code = left(coalesce(p_error_code, 'unknown'), 100),
    error_details = p_error_details, completed_at = now()
  WHERE sync_id = p_sync_id AND collector_no = p_collector_no AND status = 'running';
END;
$$;

REVOKE ALL ON FUNCTION vault_snapshot_start(smallint, uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_snapshot_fail(uuid, smallint, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault_snapshot_start(smallint, uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION vault_snapshot_fail(uuid, smallint, text, jsonb) TO service_role;

-- ── scanner data read (session-scoped) ─────────────────────────────

CREATE OR REPLACE FUNCTION vault_scanner_data_get(
  p_token text,
  p_collector_no smallint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_collector smallint;
  v_is_owner boolean;
  v_scope smallint;
BEGIN
  SELECT s.collector_no, c.is_owner INTO v_collector, v_is_owner
    FROM vault_sessions s JOIN vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'vault_access_denied'; END IF;

  IF p_collector_no IS NULL THEN
    v_scope := v_collector;
  ELSIF v_is_owner AND p_collector_no IN (1,2) THEN
    v_scope := p_collector_no;
  ELSE
    RAISE EXCEPTION 'vault_owner_only';
  END IF;

  UPDATE vault_sessions SET last_seen_at = now()
   WHERE token_hash = public.vault_hash_secret(p_token);

  RETURN jsonb_build_object(
    'items', (
      SELECT coalesce(jsonb_agg(t.row ORDER BY t.row->>'pet_name'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'id', i.id, 'pet_id', i.pet_id, 'pet_name', i.pet_name, 'category', i.category,
          'variant', i.variant, 'quantity', i.quantity, 'stack_key', i.stack_key,
          'instance_id', i.instance_id, 'inventory_uid', i.inventory_uid,
          'signature_data', i.signature_data,
          'signer_id', i.signer_id, 'signer_name', sg.signer_name,
          'signer_avatar', sg.avatar_url,
          'signer_roles',
            (SELECT jsonb_agg(r.role ORDER BY r.role) FROM vault_signer_roles r WHERE r.signer_id = i.signer_id),
          'signed_status', i.signed_status, 'verification_status', i.verification_status,
          'present', i.present, 'first_seen_at', i.first_seen_at, 'last_seen_at', i.last_seen_at,
          'data_source', i.data_source,
          'cosmic_value', cv.cosmic_value
        ) AS row
        FROM vault_inventory_items i
        LEFT JOIN vault_signers sg ON sg.id = i.signer_id
        LEFT JOIN vault_cosmic_values cv ON cv.pet_id = i.pet_id
        WHERE i.collector_no = v_scope
      ) t
    ),
    'snapshots', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'id', s.id, 'status', s.status, 'pet_count', s.pet_count,
          'added', s.added, 'removed', s.removed, 'changed', s.changed,
          'acquisitions_detected', s.acquisitions_detected,
          'error_code', s.error_code, 'started_at', s.started_at, 'completed_at', s.completed_at
        ) ORDER BY s.started_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM vault_inventory_snapshots WHERE collector_no = v_scope
            ORDER BY started_at DESC LIMIT 10) s
    ),
    'notifications', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'id', n.id, 'kind', n.kind, 'title', n.title, 'body_lines', n.body_lines,
          'shown_at', n.shown_at, 'dismissed_at', n.dismissed_at
        ) ORDER BY n.shown_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM vault_notifications WHERE collector_no = v_scope
            ORDER BY shown_at DESC LIMIT 10) n
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION vault_scanner_data_get(text, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault_scanner_data_get(text, smallint) TO service_role;

-- ── notifications (session-scoped dismiss) ─────────────────────────

CREATE OR REPLACE FUNCTION vault_notifications_manage(
  p_token text,
  p_action text,
  p_notification_id uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_collector smallint;
BEGIN
  SELECT s.collector_no INTO v_collector
    FROM vault_sessions s
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'vault_access_denied'; END IF;

  IF p_action = 'dismiss' THEN
    UPDATE vault_notifications SET dismissed_at = now()
     WHERE id = p_notification_id AND collector_no = v_collector AND dismissed_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'entry_not_found'; END IF;
    RETURN 'dismissed';
  END IF;
  RAISE EXCEPTION 'vault_invalid_action';
END;
$$;

-- ── acquisition corrections (Part 9 manual corrections) ────────────

CREATE OR REPLACE FUNCTION vault_acquisition_manage(
  p_token text,
  p_acquisition_id uuid,
  p_purchase_price numeric DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_acquisition_type text DEFAULT NULL,
  p_acquired_at date DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_collector smallint;
  v_is_owner boolean;
  v_scope smallint;
  v_existing vault_acquisitions;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  SELECT s.collector_no, c.is_owner INTO v_collector, v_is_owner
    FROM vault_sessions s JOIN vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'vault_access_denied'; END IF;

  SELECT * INTO v_existing FROM vault_acquisitions WHERE id = p_acquisition_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'entry_not_found'; END IF;

  IF v_existing.collector_no = v_collector THEN
    v_scope := v_collector;
  ELSIF v_is_owner THEN
    v_scope := v_existing.collector_no;
  ELSE
    RAISE EXCEPTION 'vault_owner_only';
  END IF;

  IF p_purchase_price IS NOT NULL AND (p_purchase_price < 0 OR p_purchase_price > 1000000000) THEN
    RAISE EXCEPTION 'invalid_price';
  END IF;
  IF p_acquisition_type IS NOT NULL AND p_acquisition_type NOT IN
     ('booth_purchase','trade','auction','giveaway','gift','manual_addition','other','unconfirmed') THEN
    RAISE EXCEPTION 'vault_invalid_action';
  END IF;

  IF p_purchase_price IS NOT NULL AND p_purchase_price IS DISTINCT FROM v_existing.purchase_price THEN
    v_changes := jsonb_set(v_changes, '{purchase_price}', to_jsonb(p_purchase_price));
  END IF;
  IF p_currency IS NOT NULL AND p_currency IS DISTINCT FROM v_existing.currency THEN
    v_changes := jsonb_set(v_changes, '{currency}', to_jsonb(p_currency));
  END IF;
  IF p_acquisition_type IS NOT NULL AND p_acquisition_type IS DISTINCT FROM v_existing.acquisition_type THEN
    v_changes := jsonb_set(v_changes, '{acquisition_type}', to_jsonb(p_acquisition_type));
  END IF;
  IF p_acquired_at IS NOT NULL AND p_acquired_at IS DISTINCT FROM v_existing.acquired_at THEN
    v_changes := jsonb_set(v_changes, '{acquired_at}', to_jsonb(p_acquired_at));
  END IF;
  IF p_notes IS NOT NULL AND p_notes IS DISTINCT FROM v_existing.notes THEN
    v_changes := jsonb_set(v_changes, '{notes}', to_jsonb(p_notes));
  END IF;

  IF v_changes = '{}'::jsonb THEN RETURN 'unchanged'; END IF;

  UPDATE vault_acquisitions SET
    purchase_price = coalesce(p_purchase_price, purchase_price),
    currency = coalesce(p_currency, currency),
    acquisition_type = coalesce(p_acquisition_type, acquisition_type),
    acquired_at = coalesce(p_acquired_at, acquired_at),
    notes = coalesce(p_notes, notes),
    updated_at = now(),
    updated_by = CASE WHEN v_scope = v_collector THEN 'collector' ELSE 'owner' END
  WHERE id = p_acquisition_id;

  INSERT INTO vault_acquisition_corrections (acquisition_id, collector_no, changed_fields, changed_by)
  VALUES (p_acquisition_id, v_scope, v_changes,
          CASE WHEN v_scope = v_collector THEN 'collector' ELSE 'owner' END);

  INSERT INTO vault_audit_log (collector_no, actor, action, detail)
  VALUES (v_scope, CASE WHEN v_scope = v_collector THEN 'collector' ELSE 'owner' END,
          'acquisition_correct', jsonb_build_object('acquisition_id', p_acquisition_id, 'changes', v_changes));

  RETURN 'updated';
END;
$$;

-- ── collection checklist (Part 7) ──────────────────────────────────

CREATE OR REPLACE FUNCTION vault_checklist_get(
  p_token text,
  p_collector_no smallint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_collector smallint;
  v_is_owner boolean;
  v_scope smallint;
BEGIN
  SELECT s.collector_no, c.is_owner INTO v_collector, v_is_owner
    FROM vault_sessions s JOIN vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'vault_access_denied'; END IF;

  IF p_collector_no IS NULL THEN
    v_scope := v_collector;
  ELSIF v_is_owner AND p_collector_no IN (1,2) THEN
    v_scope := p_collector_no;
  ELSE
    RAISE EXCEPTION 'vault_owner_only';
  END IF;

  RETURN jsonb_build_object(
    'checklist', (
      SELECT coalesce(jsonb_agg(t.row ORDER BY t.row->>'sort_value' DESC NULLS LAST, t.row->>'pet_name'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'pet_id', p.id,
          'pet_name', p.pet_name,
          'display_name', coalesce(p.display_name, p.pet_name),
          'image_url', p.image_url,
          'category', p.category,
          'signability', p.signability,
          'signability_source', p.signability_source,
          'is_huge', p.is_huge, 'is_exclusive', p.is_exclusive,
          'is_titanic', p.is_titanic, 'is_gargantuan', p.is_gargantuan,
          'created_at', p.created_at,
          'cosmic_value', cv.cosmic_value,
          'owned_verified', EXISTS (
            SELECT 1 FROM vault_pets vp
             WHERE vp.collector_no = v_scope AND vp.pet_id = p.id
               AND vp.signed_status = 'verified'
          ),
          'owned_unverified', EXISTS (
            SELECT 1 FROM vault_pets vp
             WHERE vp.collector_no = v_scope AND vp.pet_id = p.id
               AND vp.signed_status IN ('unverified','manual_review')
          ),
          'owned_any', EXISTS (
            SELECT 1 FROM vault_pets vp
             WHERE vp.collector_no = v_scope AND vp.pet_id = p.id
          ),
          'known_signers', (
            SELECT count(DISTINCT g.signer_id) FROM vault_signatures g
             WHERE g.pet_id = p.id AND g.verification_status IN ('verified','community_verified')
          ),
          'best_signature_value', (
            SELECT max(g.signature_value) FROM vault_signatures g
             WHERE g.pet_id = p.id AND g.verification_status IN ('verified','community_verified')
          ),
          'sort_value', cv.cosmic_value
        ) AS row
        FROM vault_pet_catalog p
        LEFT JOIN vault_cosmic_values cv ON cv.pet_id = p.id
      ) t
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION vault_notifications_manage(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_acquisition_manage(text, uuid, numeric, text, text, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_checklist_get(text, smallint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION vault_notifications_manage(text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION vault_acquisition_manage(text, uuid, numeric, text, text, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION vault_checklist_get(text, smallint) TO service_role;

-- ── new-acquisition notification creation (service_role, deduped) ──

CREATE OR REPLACE FUNCTION vault_notification_add(
  p_collector_no smallint,
  p_kind text,
  p_dedupe_key text,
  p_title text,
  p_body_lines jsonb,
  p_pet_entry_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_collector_no NOT IN (1,2) THEN RAISE EXCEPTION 'vault_invalid_collector'; END IF;
  INSERT INTO vault_notifications (collector_no, kind, dedupe_key, title, body_lines, pet_entry_id)
  VALUES (p_collector_no, coalesce(p_kind,'new_acquisition'), p_dedupe_key, p_title, p_body_lines, p_pet_entry_id)
  ON CONFLICT (collector_no, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION vault_notification_add(smallint, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault_notification_add(smallint, text, text, text, jsonb, uuid) TO service_role;