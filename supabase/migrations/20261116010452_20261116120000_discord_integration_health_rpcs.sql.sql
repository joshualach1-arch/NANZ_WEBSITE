/*
# Discord admin health enrichment + recent integration errors

## 1. New function: staff_discord_integration_health
Returns:
- last successful ticket creation (latest application with discord_delivered_at)
- last 10 recent integration errors (dispatch_failed events)
Passkey-checked like the other staff RPCs (server-side verification, no trust in frontend roles).

## 2. No data changes. No policy changes on public tables.
The function is SECURITY DEFINER with a pinned search_path and reads
tables anon cannot; EXECUTE is granted only to anon/authenticated as
with the sibling staff RPCs and the passkey check is enforced inside.
*/

CREATE OR REPLACE FUNCTION public.staff_discord_integration_health(p_passkey text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_delivery timestamptz;
  v_last_ref text;
  v_errors json;
BEGIN
  IF NOT staff_verify(p_passkey) THEN
    RAISE EXCEPTION 'staff_key_invalid';
  END IF;

  SELECT max(discord_delivered_at) INTO v_last_delivery
  FROM nanz_recruitment_applications
  WHERE discord_delivered_at IS NOT NULL;

  SELECT reference_code INTO v_last_ref
  FROM nanz_recruitment_applications
  WHERE discord_delivered_at IS NOT NULL
  ORDER BY discord_delivered_at DESC
  LIMIT 1;

  SELECT COALESCE(json_agg(row_to_json(e)), '[]'::json) INTO v_errors
  FROM (
    SELECT e.event_type, e.detail, e.created_at,
           a.reference_code, a.roblox_username
    FROM nanz_application_events e
    LEFT JOIN nanz_recruitment_applications a ON a.id = e.application_id
    WHERE e.event_type IN ('dispatch_failed')
    ORDER BY e.created_at DESC
    LIMIT 10
  ) e;

  RETURN json_build_object(
    'last_ticket_created_at', v_last_delivery,
    'last_ticket_reference', v_last_ref,
    'recent_errors', v_errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_discord_integration_health(text) TO anon, authenticated;