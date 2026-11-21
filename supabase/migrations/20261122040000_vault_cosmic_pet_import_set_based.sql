-- Replace the row-by-row Cosmic pet import with a set-based upsert.
-- The previous PL/pgSQL loop performed a catalog lookup and write for every
-- variant and could exceed the database statement timeout on a full import.

CREATE OR REPLACE FUNCTION public.vault_cosmic_pet_values_import(p_token text, p_values jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_owner boolean;
  v_batch uuid := gen_random_uuid();
  v_source_count integer := 0;
  v_valid_count integer := 0;
  v_matched_count integer := 0;
  v_updated_pets integer := 0;
  v_skipped integer := 0;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RAISE EXCEPTION 'vault_access_denied';
  END IF;

  SELECT c.is_owner INTO v_is_owner
  FROM public.vault_sessions s
  JOIN public.vault_collectors c ON c.collector_no = s.collector_no
  WHERE s.token_hash = public.vault_hash_secret(p_token)
    AND s.revoked_at IS NULL
    AND s.expires_at > now();

  IF v_is_owner IS NOT TRUE THEN
    RAISE EXCEPTION 'vault_owner_only';
  END IF;

  v_source_count := jsonb_array_length(coalesce(p_values, '[]'::jsonb));

  WITH input_rows AS (
    SELECT
      upper(btrim(coalesce(x.pet_name, ''))) AS pet_name,
      lower(btrim(coalesce(x.variant, 'normal'))) AS variant,
      x.value,
      nullif(btrim(x.status), '') AS status
    FROM jsonb_to_recordset(coalesce(p_values, '[]'::jsonb))
      AS x(pet_name text, variant text, value numeric, status text)
  ),
  valid_rows AS (
    SELECT *
    FROM input_rows
    WHERE pet_name <> ''
      AND variant IN ('normal','golden','rainbow','shiny','rainbow_shiny','golden_shiny')
      AND (value IS NOT NULL OR status IS NOT NULL)
  ),
  ranked_matches AS (
    SELECT
      v.*,
      p.id AS pet_id,
      row_number() OVER (
        PARTITION BY v.pet_name, v.variant
        ORDER BY
          CASE
            WHEN upper(btrim(p.pet_name)) = v.pet_name THEN 0
            WHEN upper(btrim(coalesce(p.display_name, ''))) = v.pet_name THEN 1
            ELSE 2
          END,
          p.id
      ) AS match_rank
    FROM valid_rows v
    JOIN public.vault_pet_catalog p
      ON upper(btrim(p.pet_name)) = v.pet_name
      OR upper(btrim(coalesce(p.display_name, ''))) = v.pet_name
      OR upper(btrim(coalesce(p.external_id, ''))) = v.pet_name
  ),
  matched AS (
    SELECT pet_id, variant, value, status
    FROM ranked_matches
    WHERE match_rank = 1
  ),
  aggregated AS (
    SELECT
      pet_id,
      max(value) FILTER (WHERE variant = 'normal') AS normal_value,
      max(value) FILTER (WHERE variant = 'golden') AS golden_value,
      max(value) FILTER (WHERE variant = 'rainbow') AS rainbow_value,
      max(value) FILTER (WHERE variant = 'shiny') AS shiny_value,
      max(value) FILTER (WHERE variant = 'rainbow_shiny') AS rainbow_shiny_value,
      max(value) FILTER (WHERE variant = 'golden_shiny') AS golden_shiny_value,
      max(status) FILTER (WHERE variant = 'normal') AS normal_status,
      max(status) FILTER (WHERE variant = 'golden') AS golden_status,
      max(status) FILTER (WHERE variant = 'rainbow') AS rainbow_status,
      max(status) FILTER (WHERE variant = 'shiny') AS shiny_status,
      max(status) FILTER (WHERE variant = 'rainbow_shiny') AS rainbow_shiny_status,
      max(status) FILTER (WHERE variant = 'golden_shiny') AS golden_shiny_status
    FROM matched
    GROUP BY pet_id
  ),
  upserted AS (
    INSERT INTO public.vault_cosmic_values (
      pet_id, cosmic_value, source, fetched_at, updated_at,
      normal_value, golden_value, rainbow_value, shiny_value,
      rainbow_shiny_value, golden_shiny_value,
      normal_status, golden_status, rainbow_status, shiny_status,
      rainbow_shiny_status, golden_shiny_status
    )
    SELECT
      pet_id, NULL, 'cosmic_values', now(), now(),
      normal_value, golden_value, rainbow_value, shiny_value,
      rainbow_shiny_value, golden_shiny_value,
      normal_status, golden_status, rainbow_status, shiny_status,
      rainbow_shiny_status, golden_shiny_status
    FROM aggregated
    ON CONFLICT (pet_id) DO UPDATE SET
      source = 'cosmic_values',
      fetched_at = now(),
      updated_at = now(),
      normal_value = coalesce(EXCLUDED.normal_value, public.vault_cosmic_values.normal_value),
      golden_value = coalesce(EXCLUDED.golden_value, public.vault_cosmic_values.golden_value),
      rainbow_value = coalesce(EXCLUDED.rainbow_value, public.vault_cosmic_values.rainbow_value),
      shiny_value = coalesce(EXCLUDED.shiny_value, public.vault_cosmic_values.shiny_value),
      rainbow_shiny_value = coalesce(EXCLUDED.rainbow_shiny_value, public.vault_cosmic_values.rainbow_shiny_value),
      golden_shiny_value = coalesce(EXCLUDED.golden_shiny_value, public.vault_cosmic_values.golden_shiny_value),
      normal_status = coalesce(EXCLUDED.normal_status, public.vault_cosmic_values.normal_status),
      golden_status = coalesce(EXCLUDED.golden_status, public.vault_cosmic_values.golden_status),
      rainbow_status = coalesce(EXCLUDED.rainbow_status, public.vault_cosmic_values.rainbow_status),
      shiny_status = coalesce(EXCLUDED.shiny_status, public.vault_cosmic_values.shiny_status),
      rainbow_shiny_status = coalesce(EXCLUDED.rainbow_shiny_status, public.vault_cosmic_values.rainbow_shiny_status),
      golden_shiny_status = coalesce(EXCLUDED.golden_shiny_status, public.vault_cosmic_values.golden_shiny_status)
    RETURNING pet_id
  )
  SELECT
    (SELECT count(*) FROM valid_rows),
    (SELECT count(*) FROM matched),
    (SELECT count(*) FROM upserted)
  INTO v_valid_count, v_matched_count, v_updated_pets;

  v_skipped := greatest(v_source_count - v_matched_count, 0);

  INSERT INTO public.vault_import_history(kind, source, added, updated, skipped, details, finished_at)
  VALUES (
    'cosmic', 'cosmic_values', 0, v_matched_count, v_skipped,
    jsonb_build_object(
      'batch', v_batch,
      'source_count', v_source_count,
      'valid_count', v_valid_count,
      'matched_variants', v_matched_count,
      'updated_pets', v_updated_pets
    ),
    now()
  );

  INSERT INTO public.vault_audit_log(collector_no, actor, action, detail)
  VALUES (
    1, 'owner', 'cosmic_pet_values_import',
    jsonb_build_object('updated', v_matched_count, 'updated_pets', v_updated_pets, 'skipped', v_skipped, 'batch', v_batch)
  );

  RETURN jsonb_build_object(
    'updated', v_matched_count,
    'updated_pets', v_updated_pets,
    'skipped', v_skipped,
    'batch', v_batch
  );
END;
$$;

REVOKE ALL ON FUNCTION public.vault_cosmic_pet_values_import(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_cosmic_pet_values_import(text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
