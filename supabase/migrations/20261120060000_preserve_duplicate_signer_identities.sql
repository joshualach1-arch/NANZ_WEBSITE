-- Preserve distinct signer identities even when their public/display names match.
-- Numerus can legitimately have multiple records for different Roblox accounts.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class tbl ON tbl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
     WHERE ns.nspname = 'public'
       AND tbl.relname = 'vault_signers'
       AND con.contype = 'u'
       AND array_length(con.conkey, 1) = 1
       AND (SELECT attname FROM pg_attribute
             WHERE attrelid = tbl.oid AND attnum = con.conkey[1]) = 'signer_name'
  LOOP
    EXECUTE format('ALTER TABLE public.vault_signers DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

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
  v_user_id bigint;
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
    v_user_id := nullif(v_item->>'roblox_user_id','')::bigint;
    v_name := nullif(btrim(coalesce(v_item->>'signer_name','')), '');
    IF v_username IS NULL OR v_name IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Identity matching only. Never merge on signer_name/display_name.
    SELECT id INTO v_signer
      FROM public.vault_signers
     WHERE lower(coalesce(roblox_username,'')) = lower(v_username)
        OR (v_user_id IS NOT NULL AND roblox_user_id = v_user_id)
     ORDER BY CASE WHEN lower(coalesce(roblox_username,'')) = lower(v_username) THEN 0 ELSE 1 END
     LIMIT 1;

    IF v_signer IS NULL THEN
      INSERT INTO public.vault_signers
        (signer_name, roblox_username, roblox_user_id, display_name, profile_url, avatar_url,
         is_developer, is_partner, is_creator, verification_status, data_source,
         cosmic_exclusive_value, cosmic_huge_value, cosmic_titanic_value, cosmic_demand)
      VALUES
        (v_name, v_username, v_user_id,
         coalesce(v_item->>'display_name', v_name), nullif(v_item->>'profile_url',''),
         nullif(v_item->>'avatar_url',''), coalesce((v_item->'roles') ? 'big_games_developer', false),
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
        display_name = coalesce(nullif(v_item->>'display_name',''), display_name, v_name),
        profile_url = coalesce(nullif(v_item->>'profile_url',''), profile_url),
        is_developer = is_developer OR coalesce((v_item->'roles') ? 'big_games_developer', false),
        is_partner = is_partner OR coalesce((v_item->'roles') ? 'big_games_partner', false),
        cosmic_exclusive_value = coalesce(nullif(v_item->>'exclusive_value','')::numeric, cosmic_exclusive_value),
        cosmic_huge_value = coalesce(nullif(v_item->>'huge_value','')::numeric, cosmic_huge_value),
        cosmic_titanic_value = coalesce(nullif(v_item->>'titanic_value','')::numeric, cosmic_titanic_value),
        cosmic_demand = coalesce(nullif(v_item->>'demand','')::numeric, cosmic_demand),
        roblox_user_id = coalesce(v_user_id, roblox_user_id),
        avatar_url = coalesce(nullif(v_item->>'avatar_url',''), avatar_url),
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
