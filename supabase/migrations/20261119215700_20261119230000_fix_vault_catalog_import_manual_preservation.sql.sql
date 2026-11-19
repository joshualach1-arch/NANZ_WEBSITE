-- Task 03 fix: vault_catalog_import must preserve owner-curated rows.
-- Previously only `category` was guarded; display_name (and other fields) of a
-- row the owner corrected (data_source = 'manual') were overwritten on re-import.
-- Now any row marked 'manual' is left untouched entirely and counted as skipped.

CREATE OR REPLACE FUNCTION vault_catalog_import(
  p_token text,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_is_owner boolean;
  v_added integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_item jsonb;
  v_pet uuid;
  v_existing text;
  v_batch uuid := gen_random_uuid();
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN RAISE EXCEPTION 'vault_access_denied'; END IF;
  SELECT c.is_owner INTO v_is_owner
    FROM vault_sessions s JOIN vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF v_is_owner IS NOT TRUE THEN RAISE EXCEPTION 'vault_owner_only'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF v_item->>'external_id' IS NULL OR length(v_item->>'external_id') = 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT id, data_source INTO v_pet, v_existing FROM vault_pet_catalog WHERE external_id = v_item->>'external_id';

    IF v_pet IS NULL THEN
      INSERT INTO vault_pet_catalog
        (pet_name, external_id, display_name, category, image_url, variant,
         is_huge, is_exclusive, is_titanic, is_gargantuan,
         signability, data_source, import_batch_id)
      VALUES
        (coalesce(v_item->>'pet_name', v_item->>'external_id'),
         v_item->>'external_id',
         v_item->>'display_name',
         coalesce(v_item->>'category', 'Other'),
         v_item->>'image_url',
         coalesce(v_item->>'variant', 'normal'),
         coalesce((v_item->>'is_huge')::boolean, false),
         coalesce((v_item->>'is_exclusive')::boolean, false),
         coalesce((v_item->>'is_titanic')::boolean, false),
         coalesce((v_item->>'is_gargantuan')::boolean, false),
         'unknown', 'biggames_import', v_batch);
      v_added := v_added + 1;
    ELSIF v_existing = 'manual' THEN
      -- owner-curated row: never let an import overwrite it
      v_pet := NULL;
      v_skipped := v_skipped + 1;
    ELSE
      UPDATE vault_pet_catalog SET
        display_name = coalesce(v_item->>'display_name', display_name),
        category = coalesce(v_item->>'category', category),
        image_url = coalesce(v_item->>'image_url', image_url),
        is_huge = coalesce((v_item->>'is_huge')::boolean, is_huge),
        is_exclusive = coalesce((v_item->>'is_exclusive')::boolean, is_exclusive),
        is_titanic = coalesce((v_item->>'is_titanic')::boolean, is_titanic),
        is_gargantuan = coalesce((v_item->>'is_gargantuan')::boolean, is_gargantuan),
        updated_at = now()
      WHERE id = v_pet;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  INSERT INTO vault_import_history (kind, source, added, updated, skipped, details, finished_at)
  VALUES ('catalog', 'biggames_api', v_added, v_updated, v_skipped,
          jsonb_build_object('batch', v_batch), now());

  INSERT INTO vault_audit_log (collector_no, actor, action, detail)
  VALUES (1, 'owner', 'catalog_import',
          jsonb_build_object('added', v_added, 'updated', v_updated, 'skipped', v_skipped));

  RETURN jsonb_build_object('added', v_added, 'updated', v_updated, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION vault_catalog_import(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault_catalog_import(text, jsonb) TO service_role;