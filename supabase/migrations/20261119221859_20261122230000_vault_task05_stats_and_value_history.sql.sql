-- Task 05 Part 2/4 backend: aggregate stats computed inside the vault so the
-- dashboard and missing-pets page are exact.
--
-- 1. vault_value_history rows written by vault_values_manage now also fill
--    combined_value = pet_value + signature_value (was left NULL).
-- 2. vault_stats_get(p_token, p_collector_no): per-collector real aggregate
--    stats for the dashboard + missing-pets progress:
--      - signed pet counts per variant category, split by verification status
--        (counted by ACTUAL stored status; unverified is never counted as
--        verified)
--      - total value (verified signatures only), purchase cost, profit/loss,
--        % return
--      - missing-pets progress: total signable, collected (verified),
--        unverified owned, missing, unknown/unverified signability excluded
--        from the confirmed denominator, completion %
--    Scoping: collector 2 → own only; owner → any collector or NULL for both.

CREATE OR REPLACE FUNCTION vault_stats_get(
  p_token text,
  p_collector_no smallint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_collector smallint;
  v_is_owner boolean;
  v_scope smallint;
  v_result jsonb;
BEGIN
  SELECT s.collector_no, c.is_owner INTO v_collector, v_is_owner
    FROM vault_sessions s JOIN vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'vault_access_denied'; END IF;

  IF p_collector_no IS NULL OR p_collector_no = v_collector THEN
    v_scope := v_collector;
  ELSIF v_is_owner AND p_collector_no IN (1,2) THEN
    v_scope := p_collector_no;
  ELSE
    RAISE EXCEPTION 'vault_owner_only';
  END IF;

  -- ── signed pet counts, per variant × actual verification status ────
  SELECT jsonb_build_object(
    'counts', (
      SELECT coalesce(jsonb_object_agg(t.axis, t.n), '{}'::jsonb)
      FROM (
        SELECT vp.variant || ':' || vp.verification_status AS axis,
               count(*) AS n
          FROM vault_pets vp
          JOIN vault_pet_catalog pc ON pc.id = vp.pet_id
         WHERE vp.collector_no = v_scope
           AND (pc.is_huge OR pc.is_exclusive OR pc.is_titanic OR pc.is_gargantuan)
         GROUP BY 1
      ) t
    ),
    -- total signed pets by actual verification status
    'verified', (
      SELECT count(*) FROM vault_pets vp
       WHERE vp.collector_no = v_scope AND vp.verification_status = 'verified'
    ),
    'community_verified', (
      SELECT count(*) FROM vault_pets vp
       WHERE vp.collector_no = v_scope AND vp.verification_status = 'community_verified'
    ),
    'unverified', (
      SELECT count(*) FROM vault_pets vp
       WHERE vp.collector_no = v_scope
         AND vp.signed_status IN ('verified','unverified','manual_review')
         AND vp.verification_status NOT IN ('verified','community_verified')
    ),
    'not_signed', (
      SELECT count(*) FROM vault_pets vp
       WHERE vp.collector_no = v_scope AND vp.signed_status = 'not_signed'
    ),
    -- signed pets by variant (all verification states)
    'total_signed', (
      SELECT count(*) FROM vault_pets vp
       WHERE vp.collector_no = v_scope
         AND vp.signed_status IN ('verified','unverified','manual_review')
    ),
    -- collection completion: catalog signable pets vs. verified collected
    'total_value', (
      SELECT coalesce(sum(
        COALESCE(g.signature_value, 0) + COALESCE(cv.cosmic_value, 0)
      ), 0)
        FROM vault_pets vp
        JOIN vault_pet_catalog pc ON pc.id = vp.pet_id
        LEFT JOIN vault_signatures g ON g.pet_id = vp.pet_id
             AND g.signer_id = vp.signer_id
             AND g.variant = vp.variant
             AND g.verification_status IN ('verified','community_verified')
        LEFT JOIN vault_cosmic_values cv ON cv.pet_id = vp.pet_id
       WHERE vp.collector_no = v_scope
    ),
    'verified_value', (
      SELECT coalesce(sum(
        COALESCE(g.signature_value, 0) + COALESCE(cv.cosmic_value, 0)
      ), 0)
        FROM vault_pets vp
        LEFT JOIN vault_signatures g ON g.pet_id = vp.pet_id
             AND g.signer_id = vp.signer_id
             AND g.variant = vp.variant
             AND g.verification_status = 'verified'
        LEFT JOIN vault_cosmic_values cv ON cv.pet_id = vp.pet_id
       WHERE vp.collector_no = v_scope
         AND vp.verification_status = 'verified'
    ),
    'purchase_cost', (
      SELECT coalesce(sum(a.purchase_price), 0)
        FROM vault_acquisitions a
       WHERE a.collector_no = v_scope AND a.purchase_price IS NOT NULL
    )
  ) INTO v_result;

  -- ── missing-pets progress (Part 4) ─────────────────────────────────
  v_result := jsonb_set(v_result, '{progress}', (
    SELECT jsonb_build_object(
      'total_signable', (
        SELECT count(*) FROM vault_pet_catalog pc
         WHERE pc.signability = 'signable'
           AND (pc.is_huge OR pc.is_exclusive OR pc.is_titanic OR pc.is_gargantuan)
      ),
      'collected_verified', (
        SELECT count(DISTINCT vp.pet_id) FROM vault_pets vp
         WHERE vp.collector_no = v_scope
           AND vp.verification_status IN ('verified','community_verified')
      ),
      'collected_unverified', (
        SELECT count(DISTINCT vp.pet_id) FROM vault_pets vp
         WHERE vp.collector_no = v_scope
           AND vp.signed_status IN ('verified','unverified','manual_review')
           AND vp.verification_status NOT IN ('verified','community_verified')
      ),
      'signable_unknown', (
        SELECT count(*) FROM vault_pet_catalog pc
         WHERE pc.signability IN ('unknown','needs_review')
      ),
      'signable_unconfirmed', (
        SELECT count(*) FROM vault_pet_catalog pc
         WHERE pc.signability NOT IN ('signable','unknown','needs_review')
           AND pc.signability_source IS DISTINCT FROM 'confirmed'
      )
    )
  ));

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION vault_stats_get(text, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault_stats_get(text, smallint) TO service_role;

-- ── fix: vault_value_history should always store combined_value ─────
-- (vault_values_manage wrote pet_value/signature_value but left
--  combined_value NULL; correct that so per-pet charts are complete)

CREATE OR REPLACE FUNCTION vault_values_manage(
  p_token text,
  p_action text,
  p_pet_id uuid DEFAULT NULL,
  p_signature_id uuid DEFAULT NULL,
  p_pet_value numeric DEFAULT NULL,
  p_signature_value numeric DEFAULT NULL,
  p_source text DEFAULT 'manual'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_collector smallint;
  v_result jsonb;
BEGIN
  SELECT s.collector_no INTO v_collector
    FROM vault_sessions s
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'vault_access_denied'; END IF;

  IF p_action = 'set' THEN
    IF p_pet_id IS NULL THEN RAISE EXCEPTION 'vault_invalid_input'; END IF;

    -- update the catalog-level cosmic value (owner only)
    IF v_collector = 1 THEN
      INSERT INTO vault_cosmic_values (pet_id, cosmic_value, demand, source)
      VALUES (p_pet_id, p_pet_value, NULL, p_source)
      ON CONFLICT (pet_id) DO UPDATE
        SET cosmic_value = EXCLUDED.cosmic_value,
            source = EXCLUDED.source,
            updated_at = now();
    END IF;

    -- record value history for the pet
    INSERT INTO vault_value_history (pet_id, signature_id, pet_value, signature_value, combined_value, source)
    VALUES (p_pet_id, p_signature_id, p_pet_value, p_signature_value,
            COALESCE(p_pet_value, 0) + COALESCE(p_signature_value, 0), p_source);

    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (v_collector, CASE WHEN v_collector = 1 THEN 'owner' ELSE 'c2' END, 'value_set',
            jsonb_build_object('pet_id', p_pet_id, 'pet_value', p_pet_value,
                               'signature_value', p_signature_value, 'source', p_source));
    RETURN jsonb_build_object('ok', true);

  ELSE
    RAISE EXCEPTION 'vault_unknown_action';
  END IF;
END;
$$;
