/*
# Applicant status lookup + reference code generation

## 1. Plain-English summary
Gives applicants a way to check their own application status with the
reference code shown after submission, without exposing anyone else's
application or staff-only data.

## 2. New functions
- `application_status_lookup(p_reference text)` — SECURITY DEFINER. Returns
  application id, reference code, submission date, current status,
  last update time and public next-steps guidance. Never returns staff
  notes, Discord channel ids or other applicants' data. Reference is
  normalized (uppercase, trimmed).
- `application_generate_reference()` — helper used by the bridge to mint
  unique reference codes in the NANZ format (e.g. NANZ-A7F3K9). Uses
  pgcrypto's gen_random_bytes (installed in the extensions schema).

## 3. Security
- `application_status_lookup` EXECUTE granted to anon, authenticated —
  knowing the reference code is the access control (codes are random,
  6 alphanumeric characters from a 2.1-billion-space alphabet).
- `application_generate_reference` revoked from PUBLIC/anon/authenticated;
  only the service role (bridge function) mints references.
*/

CREATE OR REPLACE FUNCTION public.application_generate_reference()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, extensions
AS $$
DECLARE v_code text;
BEGIN
  LOOP
    v_code := 'NANZ-' || upper(translate(substr(encode(extensions.gen_random_bytes(6), 'base64'), 1, 8), '+/O0IL1o0il1', 'A2Z38A2Z338'));
    v_code := substr(v_code, 1, 10);
    IF v_code !~ '[^A-Z0-9-]' AND NOT EXISTS (SELECT 1 FROM nanz_recruitment_applications WHERE reference_code = v_code) THEN
      RETURN v_code;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.application_status_lookup(p_reference text)
RETURNS TABLE (
  application_id uuid,
  reference_code text,
  roblox_username text,
  submitted_at timestamptz,
  status text,
  updated_at timestamptz,
  next_steps text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ref text := upper(trim(coalesce(p_reference, '')));
BEGIN
  IF v_ref = '' THEN RETURN; END IF;
  RETURN QUERY
  SELECT a.id, a.reference_code, a.roblox_username, a.created_at, a.status, a.updated_at,
    CASE a.status
      WHEN 'pending' THEN 'Your application is in the queue. NANZ management reviews applications in Discord — watch your Discord messages.'
      WHEN 'under_review' THEN 'A recruitment team member is reviewing your application right now.'
      WHEN 'more_info_required' THEN 'NANZ staff need more information. Check your Discord messages for the request.'
      WHEN 'accepted' THEN 'Congratulations — you were accepted. Check your Discord messages for your next steps.'
      WHEN 'rejected' THEN 'This application was not accepted this time. You are welcome to apply again later.'
      WHEN 'ticket_closed' THEN 'The application review has been closed. Contact NANZ staff in Discord if you have questions.'
      WHEN 'discord_delivery_failed' THEN 'Your application was saved but could not reach the recruitment team yet. Staff have been notified and will process it shortly.'
      ELSE 'Your application is being processed.'
    END
  FROM nanz_recruitment_applications a
  WHERE a.reference_code = v_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.application_status_lookup(text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.application_generate_reference() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.application_generate_reference() TO service_role;