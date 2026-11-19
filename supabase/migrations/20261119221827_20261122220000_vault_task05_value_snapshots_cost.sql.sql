-- Task 05 Part 7: cost tracking snapshots + richer value history for charts.
-- 1. vault_value_snapshots gains purchase_cost (sum of acquisition prices at
--    snapshot time) so the tracker can chart collection value vs. money spent
--    over time from REAL stored data only.
-- 2. vault_value_snapshots gains collector_no index usage already present.

ALTER TABLE vault_value_snapshots
  ADD COLUMN IF NOT EXISTS purchase_cost numeric;

-- Backfill: purchase_cost = sum of purchase prices of the collector's
-- acquisitions recorded up to and including each snapshot moment.
UPDATE vault_value_snapshots s
SET purchase_cost = COALESCE((
  SELECT SUM(a.purchase_price)
  FROM vault_acquisitions a
  WHERE a.collector_no = s.collector_no
    AND a.purchase_price IS NOT NULL
    AND COALESCE(a.acquired_at, a.created_at::date) <= s.captured_at::date
), 0);

-- ── vault_value_history: ensure a combined value exists ─────────────
ALTER TABLE vault_value_history
  ADD COLUMN IF NOT EXISTS pet_count integer;

-- ── scoped snapshot history for the value tracker (Part 7) ──────────
CREATE OR REPLACE FUNCTION vault_snapshots_get(
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

  IF p_collector_no IS NULL OR p_collector_no = v_collector THEN
    v_scope := v_collector;
  ELSIF v_is_owner AND p_collector_no IN (1,2) THEN
    v_scope := p_collector_no;
  ELSE
    RAISE EXCEPTION 'vault_owner_only';
  END IF;

  RETURN jsonb_build_object(
    'collector_no', v_scope,
    'snapshots', (
      SELECT coalesce(jsonb_agg(t.row_data ORDER BY t.row_data->>'captured_at'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'total_value', s.total_value,
          'purchase_cost', COALESCE(s.purchase_cost, 0),
          'pet_count', s.pet_count,
          'captured_at', s.captured_at
        ) AS row_data
        FROM vault_value_snapshots s
        WHERE s.collector_no = v_scope
      ) t
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION vault_snapshots_get(text, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault_snapshots_get(text, smallint) TO service_role;

-- ── snapshot RPC gains purchase_cost in vault_collection_manage ─────
-- (the existing 'snapshot' action already inserts total_value + pet_count;
--  extend it so purchase_cost is captured too)

CREATE OR REPLACE FUNCTION vault_collection_manage(
  p_token text,
  p_action text,
  p_pet_id uuid DEFAULT NULL,
  p_data jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_collector smallint;
  v_is_owner boolean;
  v_result jsonb;
BEGIN
  SELECT s.collector_no, c.is_owner INTO v_collector, v_is_owner
    FROM vault_sessions s JOIN vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'vault_access_denied'; END IF;

  IF p_action = 'snapshot' THEN
    -- capture current collection state
    INSERT INTO vault_value_snapshots (collector_no, total_value, pet_count, purchase_cost)
    SELECT v_collector,
           COALESCE(SUM(COALESCE(cv.cosmic_value, 0)), 0),
           COUNT(*),
           COALESCE((SELECT SUM(a.purchase_price) FROM vault_acquisitions a
                     WHERE a.collector_no = v_collector AND a.purchase_price IS NOT NULL), 0)
      FROM vault_pets vp
      LEFT JOIN vault_cosmic_values cv ON cv.pet_id = vp.pet_id
     WHERE vp.collector_no = v_collector;
    RETURN jsonb_build_object('ok', true, 'action', 'snapshot');

  ELSIF p_action = 'add' THEN
    IF p_pet_id IS NULL OR p_data IS NULL THEN
      RAISE EXCEPTION 'vault_invalid_input';
    END IF;
    INSERT INTO vault_pets (collector_no, pet_id, signer_id, variant, nickname,
                            acquired_at, purchase_price, currency, notes, added_by,
                            signed_status, verification_status, quantity)
    VALUES (v_collector, p_pet_id,
            (p_data->>'signer_id')::uuid,
            COALESCE(p_data->>'variant', 'normal'),
            p_data->>'nickname',
            (p_data->>'acquired_at')::date,
            (p_data->>'purchase_price')::numeric,
            COALESCE(p_data->>'currency', 'USD'),
            p_data->>'notes',
            CASE WHEN v_is_owner THEN 'owner' ELSE 'c2' END,
            COALESCE(p_data->>'signed_status', 'unverified'),
            COALESCE(p_data->>'verification_status', 'needs_review'),
            COALESCE((p_data->>'quantity')::int, 1))
    RETURNING jsonb_build_object('ok', true, 'pet_id', id) INTO v_result;
    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (v_collector, CASE WHEN v_is_owner THEN 'owner' ELSE 'c2' END, 'collection_add',
            jsonb_build_object('pet_id', p_pet_id));
    RETURN v_result;

  ELSIF p_action = 'update' THEN
    IF p_pet_id IS NULL OR p_data IS NULL THEN
      RAISE EXCEPTION 'vault_invalid_input';
    END IF;
    -- owner may edit either collection; collector 2 only own rows
    IF NOT v_is_owner AND NOT EXISTS (
      SELECT 1 FROM vault_pets WHERE id = p_pet_id AND collector_no = v_collector
    ) THEN
      RAISE EXCEPTION 'vault_owner_only';
    END IF;
    UPDATE vault_pets SET
      signer_id = p_data->>'signer_id',
      variant = COALESCE(p_data->>'variant', variant),
      nickname = p_data->>'nickname',
      acquired_at = (p_data->>'acquired_at')::date,
      purchase_price = (p_data->>'purchase_price')::numeric,
      currency = COALESCE(p_data->>'currency', currency),
      notes = p_data->>'notes',
      updated_at = now(),
      updated_by = CASE WHEN v_is_owner THEN 'owner' ELSE 'c2' END
    WHERE id = p_pet_id;
    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (v_collector, CASE WHEN v_is_owner THEN 'owner' ELSE 'c2' END, 'acquisition_correct',
            jsonb_build_object('pet_id', p_pet_id));
    RETURN jsonb_build_object('ok', true);

  ELSIF p_action = 'remove' THEN
    IF p_pet_id IS NULL THEN
      RAISE EXCEPTION 'vault_invalid_input';
    END IF;
    IF NOT v_is_owner AND NOT EXISTS (
      SELECT 1 FROM vault_pets WHERE id = p_pet_id AND collector_no = v_collector
    ) THEN
      RAISE EXCEPTION 'vault_owner_only';
    END IF;
    DELETE FROM vault_pets WHERE id = p_pet_id;
    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (v_collector, CASE WHEN v_is_owner THEN 'owner' ELSE 'c2' END, 'collection_remove',
            jsonb_build_object('pet_id', p_pet_id));
    RETURN jsonb_build_object('ok', true);

  ELSIF p_action = 'verify_request' THEN
    IF p_pet_id IS NULL OR p_data IS NULL THEN
      RAISE EXCEPTION 'vault_invalid_input';
    END IF;
    INSERT INTO vault_verification_requests (collector_no, pet_id, signer_id, evidence_url, notes)
    VALUES (v_collector, p_pet_id, (p_data->>'signer_id')::uuid,
            p_data->>'evidence_url', p_data->>'notes');
    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (v_collector, CASE WHEN v_is_owner THEN 'owner' ELSE 'c2' END, 'verify_request',
            jsonb_build_object('pet_id', p_pet_id));
    RETURN jsonb_build_object('ok', true);

  ELSIF p_action = 'verify_review' THEN
    IF NOT v_is_owner THEN RAISE EXCEPTION 'vault_owner_only'; END IF;
    IF p_data IS NULL OR p_data->>'request_id' IS NULL OR p_data->>'status' IS NULL THEN
      RAISE EXCEPTION 'vault_invalid_input';
    END IF;
    UPDATE vault_verification_requests
       SET status = p_data->>'status',
           reviewed_at = now(),
           reviewed_by = 'owner'
     WHERE id = (p_data->>'request_id')::uuid
    RETURNING collector_no, pet_id INTO v_collector, p_pet_id;
    IF p_data->>'status' = 'verified' AND p_pet_id IS NOT NULL THEN
      UPDATE vault_pets
         SET signed_status = 'verified',
             verification_status = 'verified',
             updated_at = now(),
             updated_by = 'owner'
       WHERE collector_no = v_collector AND pet_id = p_pet_id;
    END IF;
    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (v_collector, 'owner', 'verify_review',
            jsonb_build_object('request_id', p_data->>'request_id', 'status', p_data->>'status'));
    RETURN jsonb_build_object('ok', true);

  ELSE
    RAISE EXCEPTION 'vault_unknown_action';
  END IF;
END;
$$;
