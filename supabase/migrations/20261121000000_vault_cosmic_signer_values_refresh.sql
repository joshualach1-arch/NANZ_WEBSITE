-- Store Cosmic Values display states separately from numeric values.
ALTER TABLE public.vault_signers
  ADD COLUMN IF NOT EXISTS cosmic_exclusive_status text,
  ADD COLUMN IF NOT EXISTS cosmic_huge_status text,
  ADD COLUMN IF NOT EXISTS cosmic_titanic_status text,
  ADD COLUMN IF NOT EXISTS cosmic_demand_status text,
  ADD COLUMN IF NOT EXISTS cosmic_values_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.vault_cosmic_signer_values_import(
  p_token text,
  p_signers jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_owner boolean;
  v_item jsonb;
  v_username text;
  v_user_id bigint;
  v_updated integer := 0;
  v_skipped integer := 0;
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
    v_username := lower(ltrim(btrim(coalesce(v_item->>'roblox_username','')), '@'));
    v_user_id := nullif(v_item->>'roblox_user_id','')::bigint;
    IF v_username = '' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Match only the Roblox identity. Never match by display/signer name.
    UPDATE public.vault_signers SET
      cosmic_exclusive_value = nullif(v_item->>'exclusive_value','')::numeric,
      cosmic_huge_value = nullif(v_item->>'huge_value','')::numeric,
      cosmic_titanic_value = nullif(v_item->>'titanic_value','')::numeric,
      cosmic_demand = nullif(v_item->>'demand','')::numeric,
      cosmic_exclusive_status = nullif(v_item->>'exclusive_status',''),
      cosmic_huge_status = nullif(v_item->>'huge_status',''),
      cosmic_titanic_status = nullif(v_item->>'titanic_status',''),
      cosmic_demand_status = nullif(v_item->>'demand_status',''),
      cosmic_values_updated_at = now(),
      updated_at = now()
    WHERE (v_user_id IS NOT NULL AND roblox_user_id = v_user_id)
       OR (lower(coalesce(roblox_username,'')) = v_username
           AND (v_user_id IS NULL OR roblox_user_id IS NULL));
    IF FOUND THEN v_updated := v_updated + 1; ELSE v_skipped := v_skipped + 1; END IF;
  END LOOP;

  INSERT INTO public.vault_import_history (kind, source, added, updated, skipped, details, finished_at)
  VALUES ('signer_values','cosmic_values',0,v_updated,v_skipped,
          jsonb_build_object('batch',v_batch,'source_count',jsonb_array_length(coalesce(p_signers,'[]'::jsonb))),now());
  INSERT INTO public.vault_audit_log (collector_no, actor, action, detail)
  VALUES (1,'owner','cosmic_signer_values_import',
          jsonb_build_object('updated',v_updated,'skipped',v_skipped));
  RETURN jsonb_build_object('updated',v_updated,'skipped',v_skipped,'batch',v_batch);
END;
$$;

REVOKE ALL ON FUNCTION public.vault_cosmic_signer_values_import(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_cosmic_signer_values_import(text,jsonb) TO service_role;
