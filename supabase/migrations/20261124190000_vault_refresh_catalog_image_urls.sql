-- Refresh stale Exclusive/egg artwork URLs on the next catalog import.
-- Manual owner-supplied images remain protected; imported rows accept fresh
-- non-empty BIG Games image URLs instead of preserving stale scraped URLs.

CREATE OR REPLACE FUNCTION public.vault_catalog_import(p_token text,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE
 v_owner boolean; v_added integer:=0; v_updated integer:=0; v_skipped integer:=0;
 v_item jsonb; v_pet uuid; v_existing text; v_batch uuid:=gen_random_uuid();
BEGIN
 SELECT c.is_owner INTO v_owner FROM vault_sessions s JOIN vault_collectors c USING(collector_no)
 WHERE s.token_hash=public.vault_hash_secret(p_token) AND s.revoked_at IS NULL AND s.expires_at>now();
 IF v_owner IS NOT TRUE THEN RAISE EXCEPTION 'vault_owner_only'; END IF;
 FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) LOOP
  IF nullif(v_item->>'external_id','') IS NULL THEN v_skipped:=v_skipped+1; CONTINUE; END IF;
  SELECT id,data_source INTO v_pet,v_existing FROM vault_pet_catalog
   WHERE external_id=v_item->>'external_id'
      OR (lower(btrim(pet_name))=lower(btrim(coalesce(v_item->>'pet_name','')))
          AND coalesce(v_item->>'pet_name','')<>'')
   ORDER BY CASE WHEN external_id=v_item->>'external_id' THEN 0 ELSE 1 END LIMIT 1;
  IF v_pet IS NULL THEN
   INSERT INTO vault_pet_catalog(pet_name,external_id,display_name,category,image_url,variant,
    is_huge,is_exclusive,is_titanic,is_gargantuan,signability,data_source,import_batch_id)
   VALUES(coalesce(v_item->>'pet_name',v_item->>'external_id'),v_item->>'external_id',
    v_item->>'display_name',coalesce(v_item->>'category','Other'),nullif(v_item->>'image_url',''),
    coalesce(v_item->>'variant','normal'),coalesce((v_item->>'is_huge')::boolean,false),
    coalesce((v_item->>'is_exclusive')::boolean,false),coalesce((v_item->>'is_titanic')::boolean,false),
    coalesce((v_item->>'is_gargantuan')::boolean,false),'unknown','biggames_import',v_batch);
   v_added:=v_added+1;
  ELSIF v_existing='manual' THEN
   v_skipped:=v_skipped+1;
  ELSE
   UPDATE vault_pet_catalog SET
    external_id=coalesce(external_id,v_item->>'external_id'),
    display_name=coalesce(v_item->>'display_name',display_name),
    category=CASE WHEN data_source='biggames_import' THEN coalesce(v_item->>'category',category) ELSE category END,
    image_url=coalesce(nullif(v_item->>'image_url',''),image_url),
    is_huge=coalesce((v_item->>'is_huge')::boolean,is_huge),
    is_exclusive=coalesce((v_item->>'is_exclusive')::boolean,is_exclusive),
    is_titanic=coalesce((v_item->>'is_titanic')::boolean,is_titanic),
    is_gargantuan=coalesce((v_item->>'is_gargantuan')::boolean,is_gargantuan),
    updated_at=now() WHERE id=v_pet;
   v_updated:=v_updated+1;
  END IF;
 END LOOP;
 INSERT INTO vault_import_history(kind,source,added,updated,skipped,details,finished_at)
 VALUES('catalog','biggames_api',v_added,v_updated,v_skipped,jsonb_build_object('batch',v_batch),now());
 INSERT INTO vault_audit_log(collector_no,actor,action,detail)
 VALUES(1,'owner','catalog_import',jsonb_build_object('added',v_added,'updated',v_updated,'skipped',v_skipped));
 RETURN jsonb_build_object('added',v_added,'updated',v_updated,'skipped',v_skipped);
END $$;

CREATE OR REPLACE FUNCTION public.vault_trade_hub_exclusive_import(p_token text,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE
 v_owner boolean; v_added integer:=0; v_updated integer:=0; v_skipped integer:=0;
 v_item jsonb; v_id uuid; v_name text; v_external text;
BEGIN
 SELECT c.is_owner INTO v_owner FROM vault_sessions s JOIN vault_collectors c USING(collector_no)
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
    image_url=CASE
      WHEN data_source='manual' AND image_url IS NOT NULL THEN image_url
      ELSE coalesce(nullif(v_item->>'image_url',''),image_url)
    END,
    updated_at=now()
   WHERE id=v_id;
   v_updated:=v_updated+1;
  END IF;
  UPDATE vault_pet_catalog SET
   trade_hub_rap=coalesce(nullif(v_item->>'rap','')::numeric,trade_hub_rap),
   trade_hub_exist_count=coalesce(nullif(v_item->>'exist_count','')::bigint,trade_hub_exist_count),
   trade_hub_updated_at=now(),
   image_url=CASE
     WHEN data_source='manual' AND image_url IS NOT NULL THEN image_url
     ELSE coalesce(nullif(v_item->>'image_url',''),image_url)
   END,
   updated_at=now()
  WHERE id=v_id;
 END LOOP;
 INSERT INTO vault_import_history(kind,source,added,updated,skipped,finished_at)
 VALUES('catalog','ps99_trade_hub',v_added,v_updated,v_skipped,now());
 RETURN jsonb_build_object('added',v_added,'updated',v_updated,'skipped',v_skipped,
   'processed',jsonb_array_length(coalesce(p_items,'[]'::jsonb)));
END $$;

REVOKE ALL ON FUNCTION public.vault_catalog_import(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vault_catalog_import(text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.vault_trade_hub_exclusive_import(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vault_trade_hub_exclusive_import(text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
