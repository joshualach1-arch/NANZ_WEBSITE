-- Task 05: merged activity feed for the overview dashboard + audit entries for
-- inventory scans (scan events were previously only in the sync log).
-- Scope: collector 2 sees own events only; owner sees any scope or all scopes.

CREATE OR REPLACE FUNCTION vault_activity_feed(
  p_token text,
  p_collector_no smallint DEFAULT NULL,
  p_limit integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_collector smallint;
  v_is_owner boolean;
  v_scope smallint;
  v_limit integer;
BEGIN
  SELECT s.collector_no, c.is_owner INTO v_collector, v_is_owner
    FROM vault_sessions s JOIN vault_collectors c ON c.collector_no = s.collector_no
   WHERE s.token_hash = public.vault_hash_secret(p_token)
     AND s.revoked_at IS NULL AND s.expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'vault_access_denied'; END IF;

  v_limit := LEAST(GREATEST(coalesce(p_limit, 30), 1), 100);

  IF p_collector_no IS NULL THEN
    v_scope := v_collector;          -- default: own collection
  ELSIF NOT v_is_owner THEN
    IF p_collector_no <> v_collector THEN RAISE EXCEPTION 'vault_owner_only'; END IF;
    v_scope := v_collector;
  ELSIF p_collector_no NOT IN (1,2) THEN
    v_scope := NULL;                 -- owner with collector_no 0/NULL: all events
  ELSE
    v_scope := p_collector_no;
  END IF;

  RETURN jsonb_build_object('events', (
    SELECT coalesce(jsonb_agg(t.row ORDER BY t.at DESC), '[]'::jsonb) FROM (
      SELECT * FROM (
        SELECT a.created_at AS at, 'audit' AS kind, a.action AS event, a.actor AS actor,
               a.collector_no AS collector_no, a.detail AS detail
          FROM vault_audit_log a
         WHERE v_scope IS NULL OR a.collector_no = v_scope
        UNION ALL
        SELECT n.shown_at, 'notification', n.kind, 'system',
               n.collector_no,
               jsonb_build_object('title', n.title, 'body_lines', n.body_lines)
          FROM vault_notifications n
         WHERE n.dismissed_at IS NULL AND (v_scope IS NULL OR n.collector_no = v_scope)
        UNION ALL
        SELECT s.captured_at, 'value_snapshot', 'value_snapshot', 'system',
               s.collector_no,
               jsonb_build_object('total_value', s.total_value, 'pet_count', s.pet_count)
          FROM vault_value_snapshots s
         WHERE v_scope IS NULL OR s.collector_no = v_scope
      ) u
      ORDER BY at DESC
      LIMIT v_limit
    ) t
  ));
END;
$$;

REVOKE ALL ON FUNCTION vault_activity_feed(text, smallint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault_activity_feed(text, smallint, integer) TO service_role;

-- audit entries for inventory scans (success + failure)
CREATE OR REPLACE FUNCTION vault_audit_scan_add(
  p_collector_no smallint,
  p_status text,
  p_detail jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF p_collector_no NOT IN (1,2) THEN RAISE EXCEPTION 'vault_invalid_collector'; END IF;
  INSERT INTO vault_audit_log (collector_no, actor, action, detail)
  VALUES (p_collector_no, 'system',
          CASE WHEN p_status = 'ok' THEN 'inventory_sync' ELSE 'inventory_sync_failed' END,
          coalesce(p_detail, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION vault_audit_scan_add(smallint, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault_audit_scan_add(smallint, text, jsonb) TO service_role;