CREATE TABLE IF NOT EXISTS public.vault_egg_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  egg_name text NOT NULL UNIQUE,
  external_id text,
  image_url text,
  cosmic_value numeric(20,2),
  rap_value numeric(20,2),
  demand integer,
  value_source text NOT NULL DEFAULT 'cosmic_values',
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.vault_egg_collection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_no integer NOT NULL REFERENCES public.vault_collectors(collector_no) ON DELETE CASCADE,
  egg_id uuid NOT NULL REFERENCES public.vault_egg_catalog(id) ON DELETE CASCADE,
  owned boolean NOT NULL DEFAULT true,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  notes text,
  acquired_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collector_no, egg_id)
);
CREATE INDEX IF NOT EXISTS vault_egg_collection_collector_idx ON public.vault_egg_collection(collector_no, owned);
ALTER TABLE public.vault_egg_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_egg_collection ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.vault_egg_collection_manage(
  p_token text, p_egg_id uuid, p_owned boolean DEFAULT true, p_quantity integer DEFAULT 1,
  p_notes text DEFAULT NULL, p_acquired_at date DEFAULT NULL, p_collector_no integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $function$
DECLARE v_collector integer; v_is_owner boolean; v_scope integer;
BEGIN
  SELECT c.collector_no, c.is_owner INTO v_collector, v_is_owner
  FROM public.vault_sessions s JOIN public.vault_collectors c ON c.collector_no=s.collector_no
  WHERE s.token_hash=public.vault_hash_secret(p_token) AND s.revoked_at IS NULL AND s.expires_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION 'vault_access_denied'; END IF;
  v_scope := coalesce(p_collector_no, v_collector);
  IF v_scope <> v_collector AND NOT v_is_owner THEN RAISE EXCEPTION 'vault_owner_only'; END IF;
  IF v_scope NOT IN (1,2) OR p_quantity < 1 THEN RAISE EXCEPTION 'vault_invalid_input'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vault_egg_catalog WHERE id=p_egg_id) THEN RAISE EXCEPTION 'egg_not_found'; END IF;
  INSERT INTO public.vault_egg_collection(collector_no,egg_id,owned,quantity,notes,acquired_at)
  VALUES(v_scope,p_egg_id,p_owned,p_quantity,p_notes,p_acquired_at)
  ON CONFLICT (collector_no,egg_id) DO UPDATE SET owned=excluded.owned, quantity=excluded.quantity,
    notes=excluded.notes, acquired_at=coalesce(excluded.acquired_at,public.vault_egg_collection.acquired_at),updated_at=now();
  RETURN jsonb_build_object('ok',true,'collector_no',v_scope);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.vault_egg_collection_manage(text,uuid,boolean,integer,text,date,integer) TO anon, authenticated;