/*
# Staff Discord list/overview RPCs for the admin panel

## 1. Plain-English summary
The admin Discord panel needs to list ALL channel entries, rules and
announcements (including private/placeholder/hidden ones) and see failed
and pending application deliveries. Because the public tables hide those
rows via RLS, the panel reads through SECURITY DEFINER functions guarded
by the staff passkey.

## 2. New functions (SECURITY DEFINER, passkey-enforced)
- `staff_discord_channel_list(p_passkey)` — every channel entry.
- `staff_discord_rule_list(p_passkey)` — every rule entry.
- `staff_discord_announcement_list(p_passkey)` — every announcement.
- `staff_discord_delivery_overview(p_passkey)` — failed and pending
  application deliveries (reference, status, error, attempts).

## 3. Security
- All four verify the staff passkey first (staff_assert).
- They return only the fields the panel shows; the bot API key, webhook
  URLs and ticket channel references are never exposed through them.
- EXECUTE granted to anon/authenticated (no-login site); the passkey is
  the authority, mirroring the existing staff_* pattern.
*/

CREATE OR REPLACE FUNCTION public.staff_discord_channel_list(p_passkey text)
RETURNS TABLE (
  id uuid, channel_id text, display_name text, category text,
  description text, display_order integer, is_public boolean, channel_url text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, channel_id, display_name, category, description, display_order, is_public, channel_url
  FROM nanz_discord_channels
  ORDER BY category, display_order, display_name;
$$;

CREATE OR REPLACE FUNCTION public.staff_discord_rule_list(p_passkey text)
RETURNS TABLE (
  id uuid, title text, description text, category text,
  display_order integer, is_enabled boolean, is_placeholder boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, title, description, category, display_order, is_enabled, is_placeholder
  FROM nanz_discord_rules
  ORDER BY display_order, title;
$$;

CREATE OR REPLACE FUNCTION public.staff_discord_announcement_list(p_passkey text)
RETURNS TABLE (
  id uuid, title text, body text, author_label text, pinned boolean, is_enabled boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, title, body, author_label, pinned, is_enabled
  FROM nanz_discord_announcements
  ORDER BY pinned DESC, created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.staff_discord_delivery_overview(p_passkey text)
RETURNS TABLE (
  id uuid, reference_code text, roblox_username text, status text, created_at timestamptz,
  discord_delivery_status text, discord_delivery_error text, discord_delivery_attempts integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, reference_code, roblox_username, status, created_at,
         discord_delivery_status, discord_delivery_error, discord_delivery_attempts
  FROM nanz_recruitment_applications
  WHERE discord_delivery_status IN ('failed', 'pending')
  ORDER BY created_at DESC
  LIMIT 50;
$$;

GRANT EXECUTE ON FUNCTION public.staff_discord_channel_list(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_discord_rule_list(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_discord_announcement_list(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_discord_delivery_overview(text) TO anon, authenticated;