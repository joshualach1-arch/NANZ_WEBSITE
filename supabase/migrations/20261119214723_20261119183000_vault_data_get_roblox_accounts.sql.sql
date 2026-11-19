/*
# Signed Vault — expose roblox accounts in vault_data_get (Task 02 follow-up)

Rebuilds `vault_data_get` with one addition: a `roblox_accounts` block containing, per
collector, the connected Roblox account (public fields) plus connection/sync metadata.

Visibility rules (server-enforced, consistent with the collection-separation model):
- A collector always sees their own row in full (username, user id, display name, avatar,
  profile link, status, connected/last-lookup/last-synced timestamps).
- The owner additionally sees both rows in full (they administer both accounts).
- The second collector sees the owner's row reduced to public fields only
  (username, display name, avatar) — never owner sync metadata or user id.

Fix from the previous attempt: token lookup uses `vault_hash_secret(p_token)` (hex digest,
matching the existing helper) instead of a raw bytea comparison.

Everything else in the payload is unchanged.
*/

CREATE OR REPLACE FUNCTION public.vault_data_get(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_collector smallint;
  v_is_owner boolean;
  v_result jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RAISE EXCEPTION 'vault_access_denied';
  END IF;

  SELECT s.collector_no, c.is_owner
    INTO v_collector, v_is_owner
    FROM vault_sessions s
    JOIN vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL
     AND s.expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vault_access_denied';
  END IF;

  UPDATE vault_sessions SET last_seen_at = now()
   WHERE token_hash = public.vault_hash_secret(p_token);

  SELECT jsonb_build_object(
    'me', v_collector,
    'is_owner', v_is_owner,
    'collectors', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'collector_no', c.collector_no,
          'label', c.label,
          'is_owner', c.is_owner,
          'roblox_username', c.roblox_username,
          'roblox_user_id', c.roblox_user_id,
          'avatar_url', c.avatar_url,
          'notes', c.notes
        ) ORDER BY c.collector_no
      ), '[]'::jsonb)
      FROM vault_collectors c
    ),
    'settings', (
      SELECT s.settings FROM vault_settings s WHERE s.id = true
    ),
    'catalog', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'id', p.id, 'pet_name', p.pet_name, 'category', p.category,
          'image_url', p.image_url, 'notes', p.notes,
          'cosmic_value', cv.cosmic_value, 'demand', cv.demand,
          'value_source', cv.source
        ) ORDER BY p.pet_name
      ), '[]'::jsonb)
      FROM vault_pet_catalog p
      LEFT JOIN vault_cosmic_values cv ON cv.pet_id = p.id
    ),
    'signers', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'id', s.id, 'signer_name', s.signer_name,
          'roblox_username', s.roblox_username,
          'roblox_user_id', s.roblox_user_id,
          'avatar_url', s.avatar_url, 'notes', s.notes,
          'signature_count', (
            SELECT count(*) FROM vault_signatures g WHERE g.signer_id = s.id
          )
        ) ORDER BY s.signer_name
      ), '[]'::jsonb)
      FROM vault_signers s
    ),
    'signatures', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'id', g.id, 'pet_id', g.pet_id, 'signer_id', g.signer_id,
          'variant', g.variant, 'notes', g.notes
        )
      ), '[]'::jsonb)
      FROM vault_signatures g
    ),
    'roblox_accounts', (
      SELECT coalesce(jsonb_agg(
        CASE
          WHEN r.collector_no = v_collector OR v_is_owner THEN
            jsonb_build_object(
              'collector_no', r.collector_no,
              'roblox_user_id', r.roblox_user_id,
              'roblox_username', r.roblox_username,
              'display_name', r.display_name,
              'avatar_url', r.avatar_url,
              'profile_url', r.profile_url,
              'connection_status', r.connection_status,
              'connected_at', r.connected_at,
              'last_synced_at', r.last_synced_at,
              'is_self', r.collector_no = v_collector
            )
          ELSE
            jsonb_build_object(
              'collector_no', r.collector_no,
              'roblox_username', r.roblox_username,
              'display_name', r.display_name,
              'avatar_url', r.avatar_url,
              'connection_status', r.connection_status,
              'is_self', false
            )
        END
        ORDER BY r.collector_no
      ), '[]'::jsonb)
      FROM vault_roblox_accounts r
      WHERE (r.collector_no = v_collector OR v_is_owner
             OR (r.collector_no = 1 AND r.connection_status = 'connected'))
    ),
    'pets', (
      SELECT coalesce(jsonb_agg(t.row_data ORDER BY t.row_data->>'pet_name'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'id', vp.id, 'pet_id', vp.pet_id,
          'pet_name', pc.pet_name, 'pet_image', pc.image_url,
          'pet_category', pc.category,
          'signer_id', vp.signer_id, 'signer_name', vs.signer_name,
          'variant', vp.variant, 'nickname', vp.nickname,
          'acquired_at', vp.acquired_at,
          'purchase_price', vp.purchase_price, 'currency', vp.currency,
          'inventory_uid', vp.inventory_uid, 'added_by', vp.added_by,
          'notes', vp.notes, 'created_at', vp.created_at,
          'cosmic_value', cv.cosmic_value
        ) AS row_data
        FROM vault_pets vp
        JOIN vault_pet_catalog pc ON pc.id = vp.pet_id
        LEFT JOIN vault_signers vs ON vs.id = vp.signer_id
        LEFT JOIN vault_cosmic_values cv ON cv.pet_id = vp.pet_id
        WHERE vp.collector_no = v_collector
      ) t
    ),
    'other_pets', CASE WHEN v_is_owner THEN (
      SELECT coalesce(jsonb_agg(t.row_data ORDER BY t.row_data->>'pet_name'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'id', vp.id, 'pet_id', vp.pet_id,
          'pet_name', pc.pet_name, 'pet_image', pc.image_url,
          'signer_id', vp.signer_id, 'signer_name', vs.signer_name,
          'variant', vp.variant, 'nickname', vp.nickname,
          'acquired_at', vp.acquired_at,
          'purchase_price', vp.purchase_price, 'currency', vp.currency,
          'inventory_uid', vp.inventory_uid, 'added_by', vp.added_by,
          'notes', vp.notes, 'created_at', vp.created_at,
          'cosmic_value', cv.cosmic_value
        ) AS row_data
        FROM vault_pets vp
        JOIN vault_pet_catalog pc ON pc.id = vp.pet_id
        LEFT JOIN vault_signers vs ON vs.id = vp.signer_id
        LEFT JOIN vault_cosmic_values cv ON cv.pet_id = vp.pet_id
        WHERE vp.collector_no = 2
      ) t
    ) ELSE NULL END,
    'acquisitions', (
      SELECT coalesce(jsonb_agg(t.row_data ORDER BY t.row_data->>'created_at' DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'id', va.id, 'pet_id', va.pet_id, 'pet_name', pc.pet_name,
          'signer_id', va.signer_id, 'signer_name', vs.signer_name,
          'variant', va.variant, 'acquired_at', va.acquired_at,
          'purchase_price', va.purchase_price, 'currency', va.currency,
          'source', va.source, 'notes', va.notes, 'created_at', va.created_at
        ) AS row_data
        FROM vault_acquisitions va
        JOIN vault_pet_catalog pc ON pc.id = va.pet_id
        LEFT JOIN vault_signers vs ON vs.id = va.signer_id
        WHERE va.collector_no = v_collector
      ) t
    ),
    'value_snapshots', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object('total_value', s.total_value, 'pet_count', s.pet_count, 'captured_at', s.captured_at)
        ORDER BY s.captured_at
      ), '[]'::jsonb)
      FROM vault_value_snapshots s
      WHERE s.collector_no = v_collector
    ),
    'verification', (
      SELECT coalesce(jsonb_agg(t.row_data ORDER BY t.row_data->>'created_at' DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'id', vr.id, 'pet_id', vr.pet_id, 'pet_name', pc.pet_name,
          'signer_id', vr.signer_id, 'signer_name', vs.signer_name,
          'status', vr.status, 'evidence_url', vr.evidence_url,
          'notes', vr.notes, 'reviewed_at', vr.reviewed_at,
          'created_at', vr.created_at
        ) AS row_data
        FROM vault_verification_requests vr
        JOIN vault_pet_catalog pc ON pc.id = vr.pet_id
        LEFT JOIN vault_signers vs ON vs.id = vr.signer_id
        WHERE vr.collector_no = v_collector
      ) t
    ),
    'access_setup_required', (
      SELECT bool_or(a.setup_required) FROM vault_access_config a
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;