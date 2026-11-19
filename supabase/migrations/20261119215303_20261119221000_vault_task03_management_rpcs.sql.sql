/*
# Signed Vault — Task 03: catalog import + signer/signature/value RPCs (re-applied)

Fix from previous attempt: `vault_audit_log.collector_no` is integer, so the return-table
column of `vault_audit_get` must be integer, not smallint. All other functions unchanged.
*/

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

    SELECT id INTO v_pet FROM vault_pet_catalog WHERE external_id = v_item->>'external_id';

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
    ELSE
      UPDATE vault_pet_catalog SET
        display_name = coalesce(v_item->>'display_name', display_name),
        category = CASE WHEN data_source = 'biggames_import' THEN coalesce(v_item->>'category', category) ELSE category END,
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

CREATE OR REPLACE FUNCTION vault_signability_manage(
  p_token text,
  p_pet_id uuid,
  p_signability text,
  p_source text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_is_owner boolean;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN RAISE EXCEPTION 'vault_access_denied'; END IF;
  SELECT c.is_owner INTO v_is_owner
    FROM vault_sessions s JOIN vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF v_is_owner IS NOT TRUE THEN RAISE EXCEPTION 'vault_owner_only'; END IF;

  IF p_signability NOT IN ('signable','not_signable','unknown','needs_review') THEN
    RAISE EXCEPTION 'vault_invalid_action';
  END IF;
  IF p_source IS NULL OR length(btrim(p_source)) < 3 THEN
    RAISE EXCEPTION 'signability_source_required';
  END IF;

  UPDATE vault_pet_catalog
     SET signability = p_signability,
         signability_source = btrim(p_source),
         signability_verified_at = now(),
         updated_at = now()
   WHERE id = p_pet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'pet_not_found'; END IF;

  INSERT INTO vault_audit_log (collector_no, actor, action, detail)
  VALUES (1, 'owner', 'signability_set',
          jsonb_build_object('pet_id', p_pet_id, 'signability', p_signability, 'source', btrim(p_source)));
  RETURN 'updated';
END;
$$;

CREATE OR REPLACE FUNCTION vault_signer_manage_v2(
  p_token text,
  p_action text,
  p_signer_id uuid DEFAULT NULL,
  p_signer_name text DEFAULT NULL,
  p_roblox_username text DEFAULT NULL,
  p_roblox_user_id bigint DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_profile_url text DEFAULT NULL,
  p_roles jsonb DEFAULT NULL,
  p_is_developer boolean DEFAULT NULL,
  p_is_partner boolean DEFAULT NULL,
  p_is_creator boolean DEFAULT NULL,
  p_youtube_channel_id text DEFAULT NULL,
  p_youtube_channel_name text DEFAULT NULL,
  p_youtube_channel_url text DEFAULT NULL,
  p_youtube_avatar_url text DEFAULT NULL,
  p_youtube_subscribers bigint DEFAULT NULL,
  p_verification_status text DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_merge_target_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_is_owner boolean;
  v_signer uuid;
  v_role text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN RAISE EXCEPTION 'vault_access_denied'; END IF;
  SELECT c.is_owner INTO v_is_owner
    FROM vault_sessions s JOIN vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF v_is_owner IS NOT TRUE THEN RAISE EXCEPTION 'vault_owner_only'; END IF;

  IF p_action = 'add' THEN
    IF p_signer_name IS NULL OR length(btrim(p_signer_name)) = 0 THEN
      RAISE EXCEPTION 'signer_name_required';
    END IF;
    INSERT INTO vault_signers
      (signer_name, roblox_username, roblox_user_id, display_name, avatar_url, profile_url,
       is_developer, is_partner, is_creator,
       youtube_channel_id, youtube_channel_name, youtube_channel_url, youtube_avatar_url,
       youtube_subscribers, verification_status, data_source, notes, roblox_resolved_at)
    VALUES
      (btrim(p_signer_name), p_roblox_username, p_roblox_user_id,
       coalesce(p_display_name, btrim(p_signer_name)), p_avatar_url, p_profile_url,
       coalesce(p_is_developer, false), coalesce(p_is_partner, false), coalesce(p_is_creator, false),
       p_youtube_channel_id, p_youtube_channel_name, p_youtube_channel_url, p_youtube_avatar_url,
       p_youtube_subscribers,
       coalesce(p_verification_status, 'unverified'),
       coalesce(p_source, 'manual'), p_notes,
       CASE WHEN p_roblox_user_id IS NOT NULL THEN now() ELSE NULL END)
    RETURNING id INTO v_signer;

    IF p_roles IS NOT NULL THEN
      FOR v_role IN SELECT jsonb_array_elements_text(p_roles) LOOP
        INSERT INTO vault_signer_roles (signer_id, role) VALUES (v_signer, v_role)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;

    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (1, 'owner', 'signer_add_v2', jsonb_build_object('signer_name', p_signer_name));
    RETURN 'added';
  END IF;

  SELECT id INTO v_signer FROM vault_signers WHERE id = p_signer_id;
  IF v_signer IS NULL THEN RAISE EXCEPTION 'signer_not_found'; END IF;

  IF p_action = 'update' THEN
    UPDATE vault_signers SET
      signer_name = coalesce(p_signer_name, signer_name),
      roblox_username = coalesce(p_roblox_username, roblox_username),
      roblox_user_id = coalesce(p_roblox_user_id, roblox_user_id),
      display_name = coalesce(p_display_name, display_name),
      avatar_url = coalesce(p_avatar_url, avatar_url),
      profile_url = coalesce(p_profile_url, profile_url),
      is_developer = coalesce(p_is_developer, is_developer),
      is_partner = coalesce(p_is_partner, is_partner),
      is_creator = coalesce(p_is_creator, is_creator),
      youtube_channel_id = coalesce(p_youtube_channel_id, youtube_channel_id),
      youtube_channel_name = coalesce(p_youtube_channel_name, youtube_channel_name),
      youtube_channel_url = coalesce(p_youtube_channel_url, youtube_channel_url),
      youtube_avatar_url = coalesce(p_youtube_avatar_url, youtube_avatar_url),
      youtube_subscribers = coalesce(p_youtube_subscribers, youtube_subscribers),
      verification_status = coalesce(p_verification_status, verification_status),
      notes = coalesce(p_notes, notes),
      roblox_resolved_at = CASE WHEN p_roblox_user_id IS NOT NULL THEN now() ELSE roblox_resolved_at END,
      updated_at = now()
    WHERE id = v_signer;

    IF p_roles IS NOT NULL THEN
      DELETE FROM vault_signer_roles WHERE signer_id = v_signer;
      FOR v_role IN SELECT jsonb_array_elements_text(p_roles) LOOP
        INSERT INTO vault_signer_roles (signer_id, role) VALUES (v_signer, v_role)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;

    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (1, 'owner', 'signer_update_v2', jsonb_build_object('signer_id', v_signer));
    RETURN 'updated';

  ELSIF p_action = 'merge' THEN
    IF p_merge_target_id IS NULL OR p_merge_target_id = v_signer THEN
      RAISE EXCEPTION 'merge_target_required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vault_signers WHERE id = p_merge_target_id) THEN
      RAISE EXCEPTION 'signer_not_found';
    END IF;
    UPDATE vault_signatures SET signer_id = p_merge_target_id WHERE signer_id = v_signer;
    UPDATE vault_pets SET signer_id = p_merge_target_id WHERE signer_id = v_signer;
    UPDATE vault_acquisitions SET signer_id = p_merge_target_id WHERE signer_id = v_signer;
    UPDATE vault_verification_requests SET signer_id = p_merge_target_id WHERE signer_id = v_signer;
    INSERT INTO vault_signer_roles (signer_id, role)
      SELECT p_merge_target_id, role FROM vault_signer_roles WHERE signer_id = v_signer
      ON CONFLICT DO NOTHING;
    INSERT INTO vault_signer_socials (signer_id, platform, platform_user_id, url, verified, source)
      SELECT p_merge_target_id, platform, platform_user_id, url, verified, source
      FROM vault_signer_socials WHERE signer_id = v_signer
      ON CONFLICT (signer_id, platform) DO NOTHING;
    DELETE FROM vault_signer_roles WHERE signer_id = v_signer;
    DELETE FROM vault_signer_socials WHERE signer_id = v_signer;
    DELETE FROM vault_signers WHERE id = v_signer;
    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (1, 'owner', 'signer_merge',
            jsonb_build_object('removed', v_signer, 'kept', p_merge_target_id));
    RETURN 'merged';

  ELSIF p_action = 'delete' THEN
    DELETE FROM vault_signers WHERE id = v_signer;
    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (1, 'owner', 'signer_delete', jsonb_build_object('signer_id', v_signer));
    RETURN 'deleted';
  END IF;
  RAISE EXCEPTION 'unknown_action';
END;
$$;

CREATE OR REPLACE FUNCTION vault_signature_manage(
  p_token text,
  p_action text,
  p_signature_id uuid DEFAULT NULL,
  p_pet_id uuid DEFAULT NULL,
  p_signer_id uuid DEFAULT NULL,
  p_variant text DEFAULT 'normal',
  p_cosmic_signature_id text DEFAULT NULL,
  p_signature_name text DEFAULT NULL,
  p_signature_value numeric DEFAULT NULL,
  p_verification_status text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_is_owner boolean;
  v_sig uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN RAISE EXCEPTION 'vault_access_denied'; END IF;
  SELECT c.is_owner INTO v_is_owner
    FROM vault_sessions s JOIN vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF v_is_owner IS NOT TRUE THEN RAISE EXCEPTION 'vault_owner_only'; END IF;

  IF p_verification_status IS NOT NULL
     AND p_verification_status NOT IN ('verified','community_verified','unverified','needs_review') THEN
    RAISE EXCEPTION 'invalid_verification_status';
  END IF;

  IF p_action = 'add' THEN
    IF p_pet_id IS NULL OR p_signer_id IS NULL THEN RAISE EXCEPTION 'pet_and_signer_required'; END IF;
    INSERT INTO vault_signatures
      (pet_id, signer_id, variant, cosmic_signature_id, signature_name, signature_value,
       verification_status, source, notes)
    VALUES
      (p_pet_id, p_signer_id, coalesce(p_variant, 'normal'), p_cosmic_signature_id,
       p_signature_name, p_signature_value,
       coalesce(p_verification_status, 'unverified'), p_source, p_notes)
    ON CONFLICT (pet_id, signer_id, variant) DO UPDATE
      SET cosmic_signature_id = coalesce(excluded.cosmic_signature_id, vault_signatures.cosmic_signature_id),
          signature_name = coalesce(excluded.signature_name, vault_signatures.signature_name),
          signature_value = coalesce(excluded.signature_value, vault_signatures.signature_value),
          verification_status = coalesce(excluded.verification_status, vault_signatures.verification_status),
          source = coalesce(excluded.source, vault_signatures.source),
          notes = coalesce(excluded.notes, vault_signatures.notes),
          updated_at = now()
    RETURNING id INTO v_sig;

    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (1, 'owner', 'signature_add', jsonb_build_object('signature_id', v_sig));
    RETURN 'added';
  END IF;

  SELECT id INTO v_sig FROM vault_signatures WHERE id = p_signature_id;
  IF v_sig IS NULL THEN RAISE EXCEPTION 'signature_not_found'; END IF;

  IF p_action = 'update' THEN
    UPDATE vault_signatures SET
      cosmic_signature_id = coalesce(p_cosmic_signature_id, cosmic_signature_id),
      signature_name = coalesce(p_signature_name, signature_name),
      signature_value = coalesce(p_signature_value, signature_value),
      verification_status = coalesce(p_verification_status, verification_status),
      source = coalesce(p_source, source),
      notes = coalesce(p_notes, notes),
      updated_at = now()
    WHERE id = v_sig;
    RETURN 'updated';
  ELSIF p_action = 'verify' THEN
    UPDATE vault_signatures SET
      verification_status = coalesce(p_verification_status, 'verified'),
      verified_at = now(),
      verified_by = 'owner',
      updated_at = now()
    WHERE id = v_sig;
    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (1, 'owner', 'signature_verify', jsonb_build_object('signature_id', v_sig));
    RETURN 'verified';
  ELSIF p_action = 'delete' THEN
    DELETE FROM vault_signatures WHERE id = v_sig;
    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (1, 'owner', 'signature_delete', jsonb_build_object('signature_id', v_sig));
    RETURN 'deleted';
  END IF;
  RAISE EXCEPTION 'unknown_action';
END;
$$;

CREATE OR REPLACE FUNCTION vault_values_manage(
  p_token text,
  p_action text,
  p_pet_id uuid DEFAULT NULL,
  p_signature_id uuid DEFAULT NULL,
  p_pet_value numeric DEFAULT NULL,
  p_signature_value numeric DEFAULT NULL,
  p_combined_value numeric DEFAULT NULL,
  p_calculation_method text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_is_owner boolean;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN RAISE EXCEPTION 'vault_access_denied'; END IF;
  SELECT c.is_owner INTO v_is_owner
    FROM vault_sessions s JOIN vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF v_is_owner IS NOT TRUE THEN RAISE EXCEPTION 'vault_owner_only'; END IF;

  IF p_action = 'set_pet_value' THEN
    IF p_pet_id IS NULL THEN RAISE EXCEPTION 'pet_required'; END IF;
    INSERT INTO vault_cosmic_values (pet_id, cosmic_value, source, calculation_method,
                                     verification_status, value_timestamp, updated_at)
    VALUES (p_pet_id, p_pet_value, 'manual_import', coalesce(p_calculation_method, 'manual'),
            'unverified', now(), now())
    ON CONFLICT (pet_id) DO UPDATE
      SET cosmic_value = p_pet_value,
          source = 'manual_import',
          calculation_method = coalesce(p_calculation_method, 'manual'),
          value_timestamp = now(),
          updated_at = now();
    INSERT INTO vault_value_history (pet_id, pet_value, signature_value, combined_value, source)
    VALUES (p_pet_id, p_pet_value, p_signature_value, p_combined_value, 'manual_import');
    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (1, 'owner', 'value_set', jsonb_build_object('pet_id', p_pet_id, 'value', p_pet_value));
    RETURN 'value_set';

  ELSIF p_action = 'set_signature_value' THEN
    IF p_signature_id IS NULL THEN RAISE EXCEPTION 'signature_required'; END IF;
    UPDATE vault_signatures SET signature_value = p_signature_value, updated_at = now()
     WHERE id = p_signature_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'signature_not_found'; END IF;
    INSERT INTO vault_value_history (signature_id, signature_value, source)
    VALUES (p_signature_id, p_signature_value, 'manual_import');
    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (1, 'owner', 'signature_value_set', jsonb_build_object('signature_id', p_signature_id));
    RETURN 'value_set';
  END IF;
  RAISE EXCEPTION 'unknown_action';
END;
$$;

CREATE OR REPLACE FUNCTION vault_import_history_get(p_token text)
RETURNS TABLE (kind text, source text, added integer, updated integer, skipped integer,
               details jsonb, started_at timestamptz, finished_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_is_owner boolean;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN RAISE EXCEPTION 'vault_access_denied'; END IF;
  SELECT c.is_owner INTO v_is_owner
    FROM vault_sessions s JOIN vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF v_is_owner IS NOT TRUE THEN RAISE EXCEPTION 'vault_owner_only'; END IF;
  RETURN QUERY SELECT h.kind, h.source, h.added, h.updated, h.skipped, h.details, h.started_at, h.finished_at
    FROM vault_import_history h ORDER BY h.started_at DESC LIMIT 25;
END;
$$;

CREATE OR REPLACE FUNCTION vault_audit_get(p_token text)
RETURNS TABLE (collector_no integer, actor text, action text, detail jsonb, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_is_owner boolean;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN RAISE EXCEPTION 'vault_access_denied'; END IF;
  SELECT c.is_owner INTO v_is_owner
    FROM vault_sessions s JOIN vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF v_is_owner IS NOT TRUE THEN RAISE EXCEPTION 'vault_owner_only'; END IF;
  RETURN QUERY SELECT a.collector_no, a.actor, a.action, a.detail, a.created_at
    FROM vault_audit_log a ORDER BY a.created_at DESC LIMIT 50;
END;
$$;

CREATE OR REPLACE FUNCTION vault_value_history_get(p_token text, p_pet_id uuid)
RETURNS TABLE (pet_value numeric, signature_value numeric, combined_value numeric,
               source text, captured_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_collector smallint;
BEGIN
  v_collector := public.vault_assert_session(p_token, false);
  RETURN QUERY
    SELECT h.pet_value, h.signature_value, h.combined_value, h.source, h.captured_at
      FROM vault_value_history h
     WHERE h.pet_id = p_pet_id
     ORDER BY h.captured_at ASC
     LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION vault_catalog_import(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_signability_manage(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_signer_manage_v2(text, text, uuid, text, text, bigint, text, text, text, jsonb, boolean, boolean, boolean, text, text, text, text, bigint, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_signature_manage(text, text, uuid, uuid, uuid, text, text, text, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_values_manage(text, text, uuid, uuid, numeric, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_import_history_get(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_audit_get(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_value_history_get(text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION vault_catalog_import(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION vault_signability_manage(text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION vault_signer_manage_v2(text, text, uuid, text, text, bigint, text, text, text, jsonb, boolean, boolean, boolean, text, text, text, text, bigint, text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION vault_signature_manage(text, text, uuid, uuid, uuid, text, text, text, numeric, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION vault_values_manage(text, text, uuid, uuid, numeric, numeric, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION vault_import_history_get(text) TO service_role;
GRANT EXECUTE ON FUNCTION vault_audit_get(text) TO service_role;
GRANT EXECUTE ON FUNCTION vault_value_history_get(text, uuid) TO service_role;