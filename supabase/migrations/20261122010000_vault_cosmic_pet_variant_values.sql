-- Store Cosmic Values per pet variant without changing catalog identities or collection records.
ALTER TABLE public.vault_cosmic_values
  ADD COLUMN IF NOT EXISTS normal_value numeric(20,2),
  ADD COLUMN IF NOT EXISTS golden_value numeric(20,2),
  ADD COLUMN IF NOT EXISTS rainbow_value numeric(20,2),
  ADD COLUMN IF NOT EXISTS shiny_value numeric(20,2),
  ADD COLUMN IF NOT EXISTS rainbow_shiny_value numeric(20,2),
  ADD COLUMN IF NOT EXISTS normal_status text,
  ADD COLUMN IF NOT EXISTS golden_status text,
  ADD COLUMN IF NOT EXISTS rainbow_status text,
  ADD COLUMN IF NOT EXISTS shiny_status text,
  ADD COLUMN IF NOT EXISTS rainbow_shiny_status text;

CREATE OR REPLACE FUNCTION public.vault_cosmic_pet_values_import(p_token text, p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_is_owner boolean; v_item jsonb; v_name text; v_variant text; v_value numeric;
  v_status text; v_pet uuid; v_updated integer := 0; v_skipped integer := 0;
  v_batch uuid := gen_random_uuid();
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN RAISE EXCEPTION 'vault_access_denied'; END IF;
  SELECT c.is_owner INTO v_is_owner
    FROM public.vault_sessions s JOIN public.vault_collectors c ON c.collector_no=s.collector_no
   WHERE s.token_hash=public.vault_hash_secret(p_token) AND s.revoked_at IS NULL AND s.expires_at>now();
  IF v_is_owner IS NOT TRUE THEN RAISE EXCEPTION 'vault_owner_only'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_values,'[]'::jsonb)) LOOP
    v_name := upper(btrim(coalesce(v_item->>'pet_name','')));
    v_variant := lower(btrim(coalesce(v_item->>'variant','normal')));
    v_value := nullif(v_item->>'value','')::numeric;
    v_status := nullif(v_item->>'status','');
    IF v_name='' OR v_variant NOT IN ('normal','golden','rainbow','shiny','rainbow_shiny')
       OR (v_value IS NULL AND v_status IS NULL) THEN
      v_skipped := v_skipped+1; CONTINUE;
    END IF;

    SELECT p.id INTO v_pet FROM public.vault_pet_catalog p
     WHERE upper(btrim(p.pet_name))=v_name
        OR upper(btrim(coalesce(p.display_name,'')))=v_name
        OR upper(btrim(coalesce(p.external_id,'')))=v_name
     ORDER BY CASE WHEN upper(btrim(p.pet_name))=v_name THEN 0
                   WHEN upper(btrim(coalesce(p.display_name,'')))=v_name THEN 1 ELSE 2 END
     LIMIT 1;
    IF v_pet IS NULL THEN v_skipped:=v_skipped+1; CONTINUE; END IF;

    INSERT INTO public.vault_cosmic_values (
      pet_id, cosmic_value, source, fetched_at, updated_at,
      normal_value,golden_value,rainbow_value,shiny_value,rainbow_shiny_value,
      normal_status,golden_status,rainbow_status,shiny_status,rainbow_shiny_status
    ) VALUES (
      v_pet,NULL,'cosmic_values',now(),now(),
      CASE WHEN v_variant='normal' THEN v_value END,
      CASE WHEN v_variant='golden' THEN v_value END,
      CASE WHEN v_variant='rainbow' THEN v_value END,
      CASE WHEN v_variant='shiny' THEN v_value END,
      CASE WHEN v_variant='rainbow_shiny' THEN v_value END,
      CASE WHEN v_variant='normal' THEN v_status END,
      CASE WHEN v_variant='golden' THEN v_status END,
      CASE WHEN v_variant='rainbow' THEN v_status END,
      CASE WHEN v_variant='shiny' THEN v_status END,
      CASE WHEN v_variant='rainbow_shiny' THEN v_status END
    )
    ON CONFLICT (pet_id) DO UPDATE SET
      source='cosmic_values', fetched_at=now(), updated_at=now(),
      normal_value=CASE WHEN v_variant='normal' THEN EXCLUDED.normal_value ELSE public.vault_cosmic_values.normal_value END,
      golden_value=CASE WHEN v_variant='golden' THEN EXCLUDED.golden_value ELSE public.vault_cosmic_values.golden_value END,
      rainbow_value=CASE WHEN v_variant='rainbow' THEN EXCLUDED.rainbow_value ELSE public.vault_cosmic_values.rainbow_value END,
      shiny_value=CASE WHEN v_variant='shiny' THEN EXCLUDED.shiny_value ELSE public.vault_cosmic_values.shiny_value END,
      rainbow_shiny_value=CASE WHEN v_variant='rainbow_shiny' THEN EXCLUDED.rainbow_shiny_value ELSE public.vault_cosmic_values.rainbow_shiny_value END,
      normal_status=CASE WHEN v_variant='normal' THEN EXCLUDED.normal_status ELSE public.vault_cosmic_values.normal_status END,
      golden_status=CASE WHEN v_variant='golden' THEN EXCLUDED.golden_status ELSE public.vault_cosmic_values.golden_status END,
      rainbow_status=CASE WHEN v_variant='rainbow' THEN EXCLUDED.rainbow_status ELSE public.vault_cosmic_values.rainbow_status END,
      shiny_status=CASE WHEN v_variant='shiny' THEN EXCLUDED.shiny_status ELSE public.vault_cosmic_values.shiny_status END,
      rainbow_shiny_status=CASE WHEN v_variant='rainbow_shiny' THEN EXCLUDED.rainbow_shiny_status ELSE public.vault_cosmic_values.rainbow_shiny_status END;
    v_updated:=v_updated+1;
  END LOOP;

  INSERT INTO public.vault_import_history(kind,source,added,updated,skipped,details,finished_at)
  VALUES('cosmic','cosmic_values',0,v_updated,v_skipped,
         jsonb_build_object('batch',v_batch,'source_count',jsonb_array_length(coalesce(p_values,'[]'::jsonb))),now());
  INSERT INTO public.vault_audit_log(collector_no,actor,action,detail)
  VALUES(1,'owner','cosmic_pet_values_import',jsonb_build_object('updated',v_updated,'skipped',v_skipped,'batch',v_batch));
  RETURN jsonb_build_object('updated',v_updated,'skipped',v_skipped,'batch',v_batch);
END;
$$;
REVOKE ALL ON FUNCTION public.vault_cosmic_pet_values_import(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_cosmic_pet_values_import(text,jsonb) TO service_role;
