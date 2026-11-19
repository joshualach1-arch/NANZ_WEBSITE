/*
# Owner bootstrap RPC for the management passkey

## 1. Plain-English summary
The management passkey (which guards every staff RPC) was generated
randomly at migration time and never displayed anywhere, so the owner
could not know it and staff actions failed with staff_key_invalid.
This adds a server-side bootstrap: the bridge edge function can replace
the passkey, but only when it presents the NANZ_STAFF_PASSKEY owner
secret from the server environment.

## 2. New function
- `staff_passkey_replace(p_passkey)` — SECURITY DEFINER. Overwrites
  nanz_staff_config.staff_key with the given value (min 20 chars).
- No permission for anon/authenticated/browser code is added — EXECUTE is
  granted ONLY to service_role (the bridge function). The passkey value
  itself never appears in browser code.

## 3. Security
- Existing staff verification logic (staff_assert / staff_verify) is
  unchanged: all staff RPCs still validate against the stored key.
- The owner secret NANZ_STAFF_PASSKEY lives only in the server
  environment; a wrong or missing secret makes the bridge refuse the call.
*/

CREATE OR REPLACE FUNCTION public.staff_passkey_replace(p_passkey text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_passkey IS NULL OR length(trim(p_passkey)) < 20 THEN
    RAISE EXCEPTION 'passkey_too_short';
  END IF;
  UPDATE nanz_staff_config
  SET staff_key = trim(p_passkey), updated_at = now()
  WHERE id = true;
  RETURN 'replaced';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.staff_passkey_replace(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_passkey_replace(text) TO service_role;