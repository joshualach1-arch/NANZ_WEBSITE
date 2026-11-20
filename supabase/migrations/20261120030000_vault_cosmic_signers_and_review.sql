-- Cosmic Values signer registry import and explicit signature review workflow.
-- Values marked SOON/N/A are stored as NULL; source facts remain separate from verification.
ALTER TABLE public.vault_signers
  ADD COLUMN IF NOT EXISTS cosmic_exclusive_value numeric,
  ADD COLUMN IF NOT EXISTS cosmic_huge_value numeric,
  ADD COLUMN IF NOT EXISTS cosmic_titanic_value numeric,
  ADD COLUMN IF NOT EXISTS cosmic_demand numeric;

ALTER TABLE public.vault_pet_catalog
  ADD COLUMN IF NOT EXISTS in_game_value numeric,
  ADD COLUMN IF NOT EXISTS in_game_value_source text,
  ADD COLUMN IF NOT EXISTS in_game_value_timestamp timestamptz;

ALTER TABLE public.vault_cosmic_values
  ADD COLUMN IF NOT EXISTS in_game_value numeric,
  ADD COLUMN IF NOT EXISTS in_game_value_source text,
  ADD COLUMN IF NOT EXISTS in_game_value_timestamp timestamptz;

CREATE OR REPLACE FUNCTION public.vault_cosmic_signers_import(
  p_token text,
  p_signers jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_owner boolean;
  v_item jsonb;
  v_signer uuid;
  v_added integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_username text;
  v_name text;
  v_role text;
  v_batch uuid := gen_random_uuid();
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN RAISE EXCEPTION 'vault_access_denied'; END IF;
  SELECT c.is_owner INTO v_is_owner
    FROM public.vault_sessions s
    JOIN public.vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF v_is_owner IS NOT TRUE THEN RAISE EXCEPTION 'vault_owner_only'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_signers, '[]'::jsonb)) LOOP
    v_username := nullif(ltrim(coalesce(v_item->>'roblox_username',''), '@'), '');
    v_name := nullif(btrim(coalesce(v_item->>'signer_name','')), '');
    IF v_username IS NULL OR v_name IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT id INTO v_signer
      FROM public.vault_signers
     WHERE lower(coalesce(roblox_username,'')) = lower(v_username)
        OR (roblox_user_id IS NOT NULL AND roblox_user_id = nullif(v_item->>'roblox_user_id','')::bigint)
     ORDER BY CASE WHEN lower(coalesce(roblox_username,'')) = lower(v_username) THEN 0 ELSE 1 END
     LIMIT 1;

    IF v_signer IS NULL THEN
      INSERT INTO public.vault_signers
        (signer_name, roblox_username, display_name, profile_url, avatar_url,
         is_developer, is_partner, is_creator, verification_status, data_source,
         cosmic_exclusive_value, cosmic_huge_value, cosmic_titanic_value, cosmic_demand)
      VALUES
        (v_name, v_username, nullif(v_item->>'roblox_user_id','')::bigint, coalesce(v_item->>'display_name', v_name),
         nullif(v_item->>'profile_url',''), nullif(v_item->>'avatar_url',''), coalesce((v_item->'roles') ? 'big_games_developer', false),
         coalesce((v_item->'roles') ? 'big_games_partner', false),
         false, 'unverified', 'cosmic_values',
         nullif(v_item->>'exclusive_value','')::numeric,
         nullif(v_item->>'huge_value','')::numeric,
         nullif(v_item->>'titanic_value','')::numeric,
         nullif(v_item->>'demand','')::numeric)
      RETURNING id INTO v_signer;
      v_added := v_added + 1;
    ELSE
      UPDATE public.vault_signers SET
        signer_name = v_name,
        display_name = coalesce(display_name, v_name),
        profile_url = CASE WHEN nullif(v_item->>'roblox_user_id','') IS NOT NULL
          THEN 'https://www.roblox.com/users/' || (v_item->>'roblox_user_id') || '/profile'
          ELSE profile_url END,
        is_developer = is_developer OR coalesce((v_item->'roles') ? 'big_games_developer', false),
        is_partner = is_partner OR coalesce((v_item->'roles') ? 'big_games_partner', false),
        cosmic_exclusive_value = coalesce(nullif(v_item->>'exclusive_value','')::numeric, cosmic_exclusive_value),
        cosmic_huge_value = coalesce(nullif(v_item->>'huge_value','')::numeric, cosmic_huge_value),
        cosmic_titanic_value = coalesce(nullif(v_item->>'titanic_value','')::numeric, cosmic_titanic_value),
        cosmic_demand = coalesce(nullif(v_item->>'demand','')::numeric, cosmic_demand),
        roblox_user_id = coalesce(nullif(v_item->>'roblox_user_id','')::bigint, roblox_user_id),
        avatar_url = coalesce(nullif(v_item->>'avatar_url',''), avatar_url),
        profile_url = coalesce(nullif(v_item->>'profile_url',''), profile_url),
        data_source = CASE WHEN data_source = 'manual' THEN data_source ELSE 'cosmic_values' END,
        updated_at = now()
      WHERE id = v_signer;
      v_updated := v_updated + 1;
    END IF;

    FOR v_role IN SELECT jsonb_array_elements_text(coalesce(v_item->'roles','[]'::jsonb)) LOOP
      INSERT INTO public.vault_signer_roles (signer_id, role)
      VALUES (v_signer, v_role) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  INSERT INTO public.vault_import_history (kind, source, added, updated, skipped, details, finished_at)
  VALUES ('signer','cosmic_values',v_added,v_updated,v_skipped,
          jsonb_build_object('batch',v_batch,'source_count',jsonb_array_length(coalesce(p_signers,'[]'::jsonb))),now());

  INSERT INTO public.vault_audit_log (collector_no, actor, action, detail)
  VALUES (1,'owner','cosmic_signer_import',
          jsonb_build_object('added',v_added,'updated',v_updated,'skipped',v_skipped));

  RETURN jsonb_build_object('added',v_added,'updated',v_updated,'skipped',v_skipped,'batch',v_batch);
END;
$$;

REVOKE ALL ON FUNCTION public.vault_cosmic_signers_import(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_cosmic_signers_import(text,jsonb) TO service_role;

-- The owner can assign a signer only through an explicit review action.
CREATE OR REPLACE FUNCTION public.vault_unknown_signer_assign(
  p_token text,
  p_pet_entry_id uuid,
  p_roblox_username text,
  p_variant text DEFAULT NULL,
  p_signature_value numeric DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_owner boolean;
  v_pet uuid;
  v_signer uuid;
  v_username text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN RAISE EXCEPTION 'vault_access_denied'; END IF;
  SELECT c.is_owner INTO v_is_owner
    FROM public.vault_sessions s
    JOIN public.vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF v_is_owner IS NOT TRUE THEN RAISE EXCEPTION 'vault_owner_only'; END IF;

  SELECT pet_id INTO v_pet FROM public.vault_pets WHERE id = p_pet_entry_id;
  IF v_pet IS NULL THEN RAISE EXCEPTION 'pet_not_found'; END IF;
  v_username := lower(ltrim(btrim(coalesce(p_roblox_username,'')),'@'));
  IF length(v_username) < 3 OR length(v_username) > 20 THEN RAISE EXCEPTION 'roblox_username_invalid'; END IF;

  SELECT id INTO v_signer FROM public.vault_signers WHERE lower(roblox_username) = v_username LIMIT 1;
  IF v_signer IS NULL THEN
    RAISE EXCEPTION 'signer_not_found';
  END IF;

  UPDATE public.vault_pets SET
    signer_id = v_signer,
    signed_status = 'unverified',
    verification_status = 'needs_review',
    variant = coalesce(p_variant, variant),
    updated_at = now(),
    notes = concat_ws(E'\n', notes, nullif(p_notes,''))
   WHERE id = p_pet_entry_id;

  INSERT INTO public.vault_signatures
    (pet_id, signer_id, variant, signature_value, verification_status, source, notes)
  SELECT v_pet, v_signer, coalesce(p_variant, 'normal'), p_signature_value,
         'needs_review', 'owner_review', nullif(p_notes,'')
  ON CONFLICT (pet_id, signer_id, variant) DO UPDATE
    SET signature_value = coalesce(excluded.signature_value, public.vault_signatures.signature_value),
        verification_status = 'needs_review',
        source = 'owner_review',
        notes = coalesce(excluded.notes, public.vault_signatures.notes),
        updated_at = now();

  INSERT INTO public.vault_audit_log (collector_no, actor, action, detail)
  SELECT collector_no, 'owner', 'unknown_signer_assigned',
         jsonb_build_object('pet_entry_id',p_pet_entry_id,'signer_id',v_signer,'username',v_username)
    FROM public.vault_pets WHERE id = p_pet_entry_id;

  RETURN jsonb_build_object('signer_id',v_signer,'status','needs_review');
END;
$$;

REVOKE ALL ON FUNCTION public.vault_unknown_signer_assign(text,uuid,text,text,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_unknown_signer_assign(text,uuid,text,text,numeric,text) TO service_role;

CREATE OR REPLACE FUNCTION public.vault_manage(p_token text, p_rpc text, p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_rpc = 'vault_unknown_signer_assign' THEN
    SELECT public.vault_unknown_signer_assign(
      p_token,
      (p_params->>'p_pet_entry_id')::uuid,
      p_params->>'p_roblox_username',
      p_params->>'p_variant',
      nullif(p_params->>'p_signature_value','')::numeric,
      p_params->>'p_notes'
    ) INTO v_result;
    RETURN v_result;
  ELSIF p_rpc = 'vault_cosmic_values_manage' THEN
    PERFORM public.vault_assert_session(p_token, true);
    INSERT INTO public.vault_cosmic_values
      (pet_id, cosmic_value, source, in_game_value, in_game_value_source, in_game_value_timestamp, updated_at)
    VALUES (
      (p_params->>'p_pet_id')::uuid,
      NULL,
      'manual_import',
      nullif(p_params->>'p_in_game_value','')::numeric,
      nullif(p_params->>'p_in_game_value_source',''),
      CASE WHEN nullif(p_params->>'p_in_game_value','') IS NULL THEN NULL ELSE now() END,
      now()
    )
    ON CONFLICT (pet_id) DO UPDATE SET
      in_game_value = excluded.in_game_value,
      in_game_value_source = excluded.in_game_value_source,
      in_game_value_timestamp = excluded.in_game_value_timestamp,
      updated_at = now();
    RETURN jsonb_build_object('updated', true);
  END IF;
  RAISE EXCEPTION 'unknown_rpc';
END;
$$;
REVOKE ALL ON FUNCTION public.vault_manage(text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_manage(text,text,jsonb) TO service_role;
