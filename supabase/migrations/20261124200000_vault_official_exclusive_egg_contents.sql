ALTER TABLE public.vault_egg_catalog
  ADD COLUMN IF NOT EXISTS contents jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rarity text,
  ADD COLUMN IF NOT EXISTS source_rank integer;

CREATE OR REPLACE FUNCTION public.vault_egg_data_get(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $function$
DECLARE v_collector integer; v_is_owner boolean;
BEGIN
 SELECT c.collector_no,c.is_owner INTO v_collector,v_is_owner
 FROM public.vault_sessions s JOIN public.vault_collectors c ON c.collector_no=s.collector_no
 WHERE s.token_hash=public.vault_hash_secret(p_token) AND s.revoked_at IS NULL AND s.expires_at>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'vault_access_denied'; END IF;
 RETURN jsonb_build_object(
  'egg_catalog',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'egg_name',e.egg_name,'image_url',e.image_url,
    'cosmic_value',e.cosmic_value,'rap_value',e.rap_value,'demand',e.demand,
    'value_source',e.value_source,'contents',e.contents,'rarity',e.rarity,'source_rank',e.source_rank
  ) ORDER BY e.source_rank NULLS LAST,e.egg_name),'[]'::jsonb) FROM public.vault_egg_catalog e),
  'egg_collection',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',ec.id,'collector_no',ec.collector_no,'egg_id',ec.egg_id,'owned',ec.owned,
    'quantity',ec.quantity,'notes',ec.notes,'acquired_at',ec.acquired_at,
    'egg_name',e.egg_name,'image_url',e.image_url,'cosmic_value',e.cosmic_value,'demand',e.demand
  ) ORDER BY e.egg_name),'[]'::jsonb) FROM public.vault_egg_collection ec
  JOIN public.vault_egg_catalog e ON e.id=ec.egg_id
  WHERE ec.collector_no=v_collector OR (v_is_owner AND ec.collector_no=CASE WHEN v_collector=1 THEN 2 ELSE 1 END))
 );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.vault_egg_data_get(text) TO anon, authenticated;
NOTIFY pgrst,'reload schema';
