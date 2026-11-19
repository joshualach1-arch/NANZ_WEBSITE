-- Task 04 refinement: scanner apply v2
-- - category resolved from the catalog entry when a match exists (fallback: source label)
-- - acquisition events only for signed/possibly-signed pets, never for plain pets
-- - returns the inventory_uids that ended up VERIFIED so the scanner can raise
--   new-acquisition notifications (dedupe happens in vault_notification_add)

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
  v_verified text[] := '{}';
  v_item jsonb;
  v_pet uuid;
  v_pet_category text;
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

    SELECT id, category INTO v_pet, v_pet_category FROM vault_pet_catalog
     WHERE (v_item->>'external_pet_id' IS NOT NULL AND external_id = v_item->>'external_pet_id')
        OR lower(pet_name) = lower(coalesce(v_item->>'pet_name',''));

    v_signed := coalesce(v_item->>'signed_status', 'manual_review');
    v_verif := CASE WHEN v_signed = 'verified' THEN 'verified' ELSE 'unverified' END;

    -- signer resolution: ONLY reliable identifiers carried by the source
    v_signer := NULL;
    IF v_item->>'signer_id' IS NOT NULL THEN
      SELECT id INTO v_signer FROM vault_signers
       WHERE roblox_user_id = (v_item->>'signer_id')::bigint
          OR id::text = v_item->>'signer_id'
       LIMIT 1;
    END IF;
    -- verified signature evidence from the shared signature database
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

      -- acquisition detection: only signed/possibly-signed pets create UNCONFIRMED events
      IF v_signed <> 'not_signed' THEN
        INSERT INTO vault_acquisitions
          (collector_no, pet_id, signer_id, variant, acquired_at, source, acquisition_type,
           sync_batch_id, pet_inventory_id, purchase_price, currency, verification_status, notes)
        VALUES
          (p_collector_no, v_pet, v_signer, v_variant,
           CURRENT_DATE, 'sync', 'unconfirmed', p_sync_id, v_new_entry,
           NULL, 'USD', v_verif,
           'Detected via inventory scan. Purchase price: not available. Acquisition type: unconfirmed.');
        v_acq := v_acq + 1;
      END IF;
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

    IF v_signed = 'verified' OR (v_existing IS NOT NULL AND v_verif = 'verified'
        AND v_existing_signed <> 'verified') THEN
      v_verified := v_verified || v_uid;
    END IF;

    INSERT INTO vault_inventory_items
      (collector_no, roblox_user_id, external_pet_id, pet_id, pet_name, category, variant,
       is_golden, is_rainbow, is_shiny, is_rainbow_shiny, stack_key, quantity, instance_id,
       inventory_uid, signature_data, signer_id, signed_status, verification_status,
       owner_label, present, data_source, raw_data, first_seen_at, last_seen_at)
    VALUES
      (p_collector_no, p_roblox_user_id, v_item->>'external_pet_id', v_pet,
       coalesce(v_item->>'pet_name','Unknown pet'),
       coalesce(v_pet_category, v_item->>'category'), v_variant,
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

  -- removals: sync-managed rows no longer present in this scan
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

  UPDATE vault_inventory_snapshots SET
    status = 'complete',
    pet_count = (SELECT coalesce(sum(quantity), 0) FROM vault_pets WHERE collector_no = p_collector_no),
    added = v_added, removed = v_removed, changed = v_updated,
    acquisitions_detected = v_acq,
    completed_at = now()
  WHERE id = v_snapshot;

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
                            'acquisitions', v_acq, 'verified_uids', to_jsonb(v_verified));
END;
$$;

REVOKE ALL ON FUNCTION vault_inventory_apply(smallint, jsonb, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault_inventory_apply(smallint, jsonb, uuid, bigint) TO service_role;