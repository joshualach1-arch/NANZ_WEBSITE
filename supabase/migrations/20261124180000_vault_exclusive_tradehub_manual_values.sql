-- Exclusive catalog: independent Trade Hub metrics and protected manual valuation.
ALTER TABLE public.vault_pet_catalog
  ADD COLUMN IF NOT EXISTS trade_hub_rap numeric(20,2),
  ADD COLUMN IF NOT EXISTS trade_hub_exist_count bigint,
  ADD COLUMN IF NOT EXISTS trade_hub_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_value numeric(20,2),
  ADD COLUMN IF NOT EXISTS manual_value_source text,
  ADD COLUMN IF NOT EXISTS manual_value_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_value_locked boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.vault_trade_hub_exclusive_import(p_token text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_owner boolean; v_added integer:=0; v_updated integer:=0; v_skipped integer:=0; v_item jsonb; v_id uuid; v_name text; v_external text;
BEGIN
  SELECT c.is_owner INTO v_owner FROM vault_sessions s JOIN vault_collectors c USING (collector_no)
  WHERE s.token_hash=public.vault_hash_secret(p_token) AND s.revoked_at IS NULL AND s.expires_at>now();
  IF v_owner IS NOT TRUE THEN RAISE EXCEPTION 'vault_owner_only'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) LOOP
    v_name:=nullif(btrim(v_item->>'pet_name'),'');
    IF v_name IS NULL THEN v_skipped:=v_skipped+1; CONTINUE; END IF;
    v_external:='tradehub-exclusive:'||regexp_replace(lower(v_name),'[^a-z0-9]+','-','g');
    SELECT id INTO v_id FROM vault_pet_catalog
      WHERE lower(btrim(pet_name))=lower(v_name) OR lower(btrim(coalesce(display_name,'')))=lower(v_name)
      ORDER BY CASE WHEN is_exclusive THEN 0 ELSE 1 END LIMIT 1;
    IF v_id IS NULL THEN
      INSERT INTO vault_pet_catalog(pet_name,external_id,display_name,category,image_url,is_huge,is_exclusive,is_titanic,is_gargantuan,signability,data_source)
      VALUES(v_name,v_external,v_name,'Exclusive',nullif(v_item->>'image_url',''),false,true,false,false,'unknown','trade_hub_import')
      RETURNING id INTO v_id;
      v_added:=v_added+1;
    ELSE
      UPDATE vault_pet_catalog SET
        is_exclusive=true,
        trade_hub_rap=coalesce(nullif(v_item->>'rap','')::numeric,trade_hub_rap),
        trade_hub_exist_count=coalesce(nullif(v_item->>'exist_count','')::bigint,trade_hub_exist_count),
        trade_hub_updated_at=now(),
        image_url=coalesce(image_url,nullif(v_item->>'image_url','')),
        updated_at=now()
      WHERE id=v_id;
      v_updated:=v_updated+1;
    END IF;
    UPDATE vault_pet_catalog SET
      trade_hub_rap=coalesce(nullif(v_item->>'rap','')::numeric,trade_hub_rap),
      trade_hub_exist_count=coalesce(nullif(v_item->>'exist_count','')::bigint,trade_hub_exist_count),
      trade_hub_updated_at=now(),
      image_url=coalesce(image_url,nullif(v_item->>'image_url','')),
      updated_at=now()
    WHERE id=v_id;
  END LOOP;
  INSERT INTO vault_import_history(kind,source,added,updated,skipped,finished_at)
  VALUES('catalog','ps99_trade_hub',v_added,v_updated,v_skipped,now());
  RETURN jsonb_build_object('added',v_added,'updated',v_updated,'skipped',v_skipped,'processed',jsonb_array_length(coalesce(p_items,'[]'::jsonb)));
END $$;

CREATE OR REPLACE FUNCTION public.vault_catalog_manual_manage(
 p_token text,p_pet_name text,p_image_url text,p_manual_value numeric,p_pet_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_owner boolean; v_id uuid; v_external text;
BEGIN
 SELECT c.is_owner INTO v_owner FROM vault_sessions s JOIN vault_collectors c USING(collector_no)
 WHERE s.token_hash=public.vault_hash_secret(p_token) AND s.revoked_at IS NULL AND s.expires_at>now();
 IF v_owner IS NOT TRUE THEN RAISE EXCEPTION 'vault_owner_only'; END IF;
 IF nullif(btrim(p_pet_name),'') IS NULL THEN RAISE EXCEPTION 'pet_name_required'; END IF;
 IF p_pet_id IS NOT NULL THEN
   UPDATE vault_pet_catalog SET pet_name=btrim(p_pet_name),display_name=btrim(p_pet_name),
    image_url=coalesce(nullif(btrim(p_image_url),''),image_url),category='Exclusive',
    is_exclusive=true,manual_value=p_manual_value,manual_value_source='manual',
    manual_value_updated_at=now(),manual_value_locked=true,data_source='manual',updated_at=now()
   WHERE id=p_pet_id RETURNING id INTO v_id;
 ELSE
   v_external:='manual-exclusive:'||regexp_replace(lower(btrim(p_pet_name)),'[^a-z0-9]+','-','g');
   INSERT INTO vault_pet_catalog(pet_name,external_id,display_name,category,image_url,is_huge,is_exclusive,is_titanic,is_gargantuan,signability,data_source,manual_value,manual_value_source,manual_value_updated_at,manual_value_locked)
   VALUES(btrim(p_pet_name),v_external,btrim(p_pet_name),'Exclusive',nullif(btrim(p_image_url),''),false,true,false,false,'unknown','manual',p_manual_value,'manual',now(),true)
   ON CONFLICT(pet_name) DO UPDATE SET
     display_name=EXCLUDED.display_name,image_url=coalesce(EXCLUDED.image_url,vault_pet_catalog.image_url),
     category='Exclusive',is_exclusive=true,manual_value=EXCLUDED.manual_value,
     manual_value_source='manual',manual_value_updated_at=now(),manual_value_locked=true,data_source='manual',updated_at=now()
   RETURNING id INTO v_id;
 END IF;
 IF v_id IS NULL THEN RAISE EXCEPTION 'pet_not_found'; END IF;
 INSERT INTO vault_audit_log(collector_no,actor,action,detail)
 VALUES(1,'owner','exclusive_manual_upsert',jsonb_build_object('pet_id',v_id,'pet_name',btrim(p_pet_name)));
 RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.vault_trade_hub_exclusive_import(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vault_trade_hub_exclusive_import(text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.vault_catalog_manual_manage(text,text,text,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vault_catalog_manual_manage(text,text,text,numeric,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
