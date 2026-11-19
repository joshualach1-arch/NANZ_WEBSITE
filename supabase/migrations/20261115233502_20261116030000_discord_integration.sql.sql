/*
# Discord integration foundation

## 1. Plain-English summary
Connects the website to the existing NANZ CORE Discord bot for recruitment.
Website applications are stored first, then delivered to the bot's ticket
system. The bot calls back to update the website status. Nothing about the
bot token or private channels is ever readable by the browser.

## 2. Modified tables
- `nanz_discord_config` (already existed — extended, single row):
  - Added: `server_icon_url`, `recruitment_category_id`, `bot_endpoint`,
    `bot_api_key`, `notify_channel_ids` (jsonb), `bot_health_status`,
    `bot_last_health_check_at`, `bot_health_detail`.
  - `guild_name` remains the server display name. `invite_url`/`guild_id`
    already existed. The bot API key and endpoint are PRIVATE (service_role
    only). A public view exposes only invite/guild/name/icon.

## 3. New tables
- `nanz_discord_channels`: configured channel links. `is_public` controls
  whether the public page shows it. `channel_id` is the real Discord
  channel snowflake entered by staff — never invented.
- `nanz_discord_rules`: server rules. `is_placeholder` marks content that
  is NOT yet official (placeholders are hidden from the public page).
- `nanz_discord_announcements`: community announcements.
- `nanz_application_events`: audit log for every application status change
  with a unique `event_key` for idempotent bot callbacks.

## 4. Modified: `nanz_recruitment_applications`
- Added: `reference_code` (unique applicant-facing reference),
  `discord_delivery_status` (pending|sent|failed|disabled),
  `discord_delivery_attempts`, `discord_delivery_error`,
  `discord_ticket_channel_id`, `discord_ticket_message_id`,
  `discord_guild_id`, `discord_delivered_at`, `discord_last_dispatch_at`.
  All private columns (no grants to anon/authenticated).

## 5. Security
- RLS on all new tables. Public read: channels only when `is_public`,
  rules only when enabled and not placeholder, announcements when enabled,
  application events. Applications: column-level INSERT/SELECT grants for
  applicant fields only; status/notes/Discord bookkeeping are not
  browser-writable. Public status lookup happens via RPC (next migration).
- New passkey-enforced staff RPCs (same pattern as existing staff_*):
  config read/write, channel manage, rule manage, announcement manage,
  failed-delivery retry. EXECUTE granted to anon/authenticated because the
  site has no login; the private staff passkey inside each function is the
  real authority.

## 6. Notes
- The existing `nanz_discord_link_logs` table and the config row's
  webhook_url/role_mapping/auto flags are left untouched.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='nanz_discord_config' AND column_name='server_icon_url') THEN
    ALTER TABLE public.nanz_discord_config
      ADD COLUMN server_icon_url text,
      ADD COLUMN recruitment_category_id text,
      ADD COLUMN bot_endpoint text,
      ADD COLUMN bot_api_key text,
      ADD COLUMN notify_channel_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN bot_health_status text,
      ADD COLUMN bot_last_health_check_at timestamptz,
      ADD COLUMN bot_health_detail text;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.nanz_discord_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text,
  display_name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  description text,
  display_order integer NOT NULL DEFAULT 100,
  is_public boolean NOT NULL DEFAULT false,
  channel_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.nanz_discord_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  display_order integer NOT NULL DEFAULT 100,
  is_enabled boolean NOT NULL DEFAULT true,
  is_placeholder boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.nanz_discord_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  author_label text,
  pinned boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.nanz_application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.nanz_recruitment_applications(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor text NOT NULL,
  detail text,
  event_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nanz_application_events_app_idx
  ON public.nanz_application_events (application_id, created_at DESC);

ALTER TABLE public.nanz_discord_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nanz_discord_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nanz_discord_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nanz_application_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.nanz_recruitment_applications
  ADD COLUMN IF NOT EXISTS reference_code text,
  ADD COLUMN IF NOT EXISTS discord_delivery_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS discord_delivery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discord_delivery_error text,
  ADD COLUMN IF NOT EXISTS discord_ticket_channel_id text,
  ADD COLUMN IF NOT EXISTS discord_ticket_message_id text,
  ADD COLUMN IF NOT EXISTS discord_guild_id text,
  ADD COLUMN IF NOT EXISTS discord_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS discord_last_dispatch_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS nanz_applications_reference_code_key
  ON public.nanz_recruitment_applications (reference_code);
CREATE INDEX IF NOT EXISTS nanz_applications_delivery_status_idx
  ON public.nanz_recruitment_applications (discord_delivery_status)
  WHERE discord_delivery_status IN ('pending','failed');

CREATE OR REPLACE VIEW public.nanz_discord_config_public AS
  SELECT invite_url, guild_id, guild_name, server_icon_url
  FROM public.nanz_discord_config WHERE id = true;

GRANT SELECT ON public.nanz_discord_config_public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nanz_discord_channels, public.nanz_discord_rules, public.nanz_discord_announcements, public.nanz_application_events TO service_role;
GRANT SELECT, UPDATE ON public.nanz_discord_config TO service_role;
GRANT SELECT (roblox_username, roblox_user_id, discord_username, daily_playtime, daily_points_potential, previous_clan, experience, status, created_at, updated_at, reference_code)
  ON public.nanz_recruitment_applications TO anon, authenticated;
GRANT INSERT (roblox_username, roblox_user_id, discord_username, daily_playtime, daily_points_potential, previous_clan, experience)
  ON public.nanz_recruitment_applications TO anon, authenticated;
GRANT SELECT ON public.nanz_application_events TO anon, authenticated;

REVOKE ALL ON public.nanz_discord_config FROM anon, authenticated;

DROP POLICY IF EXISTS "discord_channels_public_read" ON public.nanz_discord_channels;
CREATE POLICY "discord_channels_public_read" ON public.nanz_discord_channels
  FOR SELECT TO anon, authenticated USING (is_public = true);

DROP POLICY IF EXISTS "discord_rules_public_read" ON public.nanz_discord_rules;
CREATE POLICY "discord_rules_public_read" ON public.nanz_discord_rules
  FOR SELECT TO anon, authenticated USING (is_enabled = true AND is_placeholder = false);

DROP POLICY IF EXISTS "discord_announcements_public_read" ON public.nanz_discord_announcements;
CREATE POLICY "discord_announcements_public_read" ON public.nanz_discord_announcements
  FOR SELECT TO anon, authenticated USING (is_enabled = true);

DROP POLICY IF EXISTS "application_events_public_read" ON public.nanz_application_events;
CREATE POLICY "application_events_public_read" ON public.nanz_application_events
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "applications_public_insert_own" ON public.nanz_recruitment_applications;
CREATE POLICY "applications_public_insert_own" ON public.nanz_recruitment_applications
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    roblox_username IS NOT NULL AND length(trim(roblox_username)) BETWEEN 3 AND 32
    AND discord_username IS NOT NULL AND length(trim(discord_username)) BETWEEN 2 AND 100
    AND daily_playtime IN ('1–2 hours','3–4 hours','5+ hours')
    AND daily_points_potential IN ('1,000–2,000','2,000–5,000','5,000+')
    AND experience IS NOT NULL AND length(trim(experience)) BETWEEN 20 AND 4000
  );

-- Applications have no anon SELECT policy: applicants use the
-- application_status_lookup RPC, staff use passkey RPCs, the bridge uses
-- service_role. Direct table reads stay service_role only.

CREATE OR REPLACE FUNCTION public.staff_discord_config_read(p_passkey text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_cfg nanz_discord_config%ROWTYPE;
BEGIN
  PERFORM staff_assert(p_passkey);
  SELECT * INTO v_cfg FROM nanz_discord_config WHERE id = true;
  RETURN jsonb_build_object(
    'invite_url', v_cfg.invite_url,
    'guild_id', v_cfg.guild_id,
    'server_name', v_cfg.guild_name,
    'server_icon_url', v_cfg.server_icon_url,
    'recruitment_category_id', v_cfg.recruitment_category_id,
    'bot_endpoint', v_cfg.bot_endpoint,
    'has_bot_api_key', v_cfg.bot_api_key IS NOT NULL,
    'notify_channel_ids', v_cfg.notify_channel_ids,
    'bot_health_status', v_cfg.bot_health_status,
    'bot_last_health_check_at', v_cfg.bot_last_health_check_at,
    'bot_health_detail', v_cfg.bot_health_detail
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_discord_config_write(
  p_passkey text, p_invite_url text DEFAULT NULL, p_guild_id text DEFAULT NULL,
  p_server_name text DEFAULT NULL, p_server_icon_url text DEFAULT NULL,
  p_recruitment_category_id text DEFAULT NULL, p_bot_endpoint text DEFAULT NULL,
  p_bot_api_key text DEFAULT NULL, p_notify_channel_ids jsonb DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM staff_assert(p_passkey);
  IF p_invite_url IS NOT NULL AND p_invite_url <> '' AND p_invite_url !~ '^https://(discord\.gg|discord\.com/invite)/[\w-]+$' THEN
    RAISE EXCEPTION 'invalid_invite_url';
  END IF;
  IF p_bot_endpoint IS NOT NULL AND p_bot_endpoint <> '' AND p_bot_endpoint !~ '^https://[\w.-]+(/[\w./-]*)?$' THEN
    RAISE EXCEPTION 'invalid_bot_endpoint';
  END IF;
  UPDATE nanz_discord_config SET
    invite_url = CASE WHEN p_invite_url = '' THEN NULL WHEN p_invite_url IS NOT NULL THEN p_invite_url ELSE invite_url END,
    guild_id = CASE WHEN p_guild_id = '' THEN NULL WHEN p_guild_id IS NOT NULL THEN p_guild_id ELSE guild_id END,
    guild_name = CASE WHEN p_server_name = '' THEN NULL WHEN p_server_name IS NOT NULL THEN p_server_name ELSE guild_name END,
    server_icon_url = CASE WHEN p_server_icon_url = '' THEN NULL WHEN p_server_icon_url IS NOT NULL THEN p_server_icon_url ELSE server_icon_url END,
    recruitment_category_id = CASE WHEN p_recruitment_category_id = '' THEN NULL WHEN p_recruitment_category_id IS NOT NULL THEN p_recruitment_category_id ELSE recruitment_category_id END,
    bot_endpoint = CASE WHEN p_bot_endpoint = '' THEN NULL WHEN p_bot_endpoint IS NOT NULL THEN p_bot_endpoint ELSE bot_endpoint END,
    bot_api_key = CASE WHEN p_bot_api_key = '' THEN NULL WHEN p_bot_api_key IS NOT NULL THEN p_bot_api_key ELSE bot_api_key END,
    notify_channel_ids = COALESCE(p_notify_channel_ids, notify_channel_ids),
    updated_at = now()
  WHERE id = true;
  RETURN 'updated';
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_discord_channel_manage(
  p_passkey text, p_action text, p_channel_entry_id uuid DEFAULT NULL,
  p_channel_id text DEFAULT NULL, p_display_name text DEFAULT NULL,
  p_category text DEFAULT NULL, p_description text DEFAULT NULL,
  p_display_order integer DEFAULT NULL, p_is_public boolean DEFAULT NULL,
  p_channel_url text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM staff_assert(p_passkey);
  IF p_action = 'add' THEN
    IF p_display_name IS NULL OR length(trim(p_display_name)) = 0 THEN RAISE EXCEPTION 'name_required'; END IF;
    IF p_category NOT IN ('general','competitive','support','community') THEN RAISE EXCEPTION 'bad_category'; END IF;
    INSERT INTO nanz_discord_channels (channel_id, display_name, category, description, display_order, is_public, channel_url)
    VALUES (p_channel_id, trim(p_display_name), p_category, p_description, COALESCE(p_display_order, 100), COALESCE(p_is_public, false), p_channel_url);
    RETURN 'added';
  END IF;
  IF p_channel_entry_id IS NULL THEN RAISE EXCEPTION 'entry_id_required'; END IF;
  IF p_action = 'update' THEN
    UPDATE nanz_discord_channels SET
      channel_id = COALESCE(p_channel_id, channel_id),
      display_name = COALESCE(p_display_name, display_name),
      category = COALESCE(p_category, category),
      description = COALESCE(p_description, description),
      display_order = COALESCE(p_display_order, display_order),
      is_public = COALESCE(p_is_public, is_public),
      channel_url = COALESCE(p_channel_url, channel_url),
      updated_at = now()
    WHERE id = p_channel_entry_id;
    RETURN 'updated';
  ELSIF p_action = 'delete' THEN
    DELETE FROM nanz_discord_channels WHERE id = p_channel_entry_id;
    RETURN 'deleted';
  END IF;
  RAISE EXCEPTION 'unknown_action';
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_discord_rule_manage(
  p_passkey text, p_action text, p_rule_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL, p_description text DEFAULT NULL,
  p_category text DEFAULT NULL, p_display_order integer DEFAULT NULL,
  p_is_enabled boolean DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM staff_assert(p_passkey);
  IF p_action = 'add' THEN
    IF p_title IS NULL OR length(trim(p_title)) = 0 THEN RAISE EXCEPTION 'title_required'; END IF;
    IF p_description IS NULL OR length(trim(p_description)) = 0 THEN RAISE EXCEPTION 'description_required'; END IF;
    IF p_category NOT IN ('conduct','competitive','recruitment','community','support') THEN RAISE EXCEPTION 'bad_category'; END IF;
    INSERT INTO nanz_discord_rules (title, description, category, display_order, is_enabled, is_placeholder)
    VALUES (trim(p_title), trim(p_description), p_category, COALESCE(p_display_order, 100), true, false);
    RETURN 'added';
  END IF;
  IF p_rule_id IS NULL THEN RAISE EXCEPTION 'rule_id_required'; END IF;
  IF p_action = 'update' THEN
    UPDATE nanz_discord_rules SET
      title = COALESCE(p_title, title),
      description = COALESCE(p_description, description),
      category = COALESCE(p_category, category),
      display_order = COALESCE(p_display_order, display_order),
      is_enabled = COALESCE(p_is_enabled, is_enabled),
      updated_at = now()
    WHERE id = p_rule_id;
    RETURN 'updated';
  ELSIF p_action = 'toggle' THEN
    UPDATE nanz_discord_rules SET is_enabled = COALESCE(p_is_enabled, NOT is_enabled), updated_at = now() WHERE id = p_rule_id;
    RETURN 'toggled';
  ELSIF p_action = 'delete' THEN
    DELETE FROM nanz_discord_rules WHERE id = p_rule_id;
    RETURN 'deleted';
  END IF;
  RAISE EXCEPTION 'unknown_action';
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_discord_announcement_manage(
  p_passkey text, p_action text, p_announcement_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL, p_body text DEFAULT NULL,
  p_author_label text DEFAULT NULL, p_pinned boolean DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM staff_assert(p_passkey);
  IF p_action = 'add' THEN
    IF p_title IS NULL OR length(trim(p_title)) = 0 THEN RAISE EXCEPTION 'title_required'; END IF;
    IF p_body IS NULL OR length(trim(p_body)) = 0 THEN RAISE EXCEPTION 'body_required'; END IF;
    INSERT INTO nanz_discord_announcements (title, body, author_label, pinned)
    VALUES (trim(p_title), trim(p_body), p_author_label, COALESCE(p_pinned, false));
    RETURN 'added';
  END IF;
  IF p_announcement_id IS NULL THEN RAISE EXCEPTION 'announcement_id_required'; END IF;
  IF p_action = 'update' THEN
    UPDATE nanz_discord_announcements SET
      title = COALESCE(p_title, title),
      body = COALESCE(p_body, body),
      author_label = COALESCE(p_author_label, author_label),
      pinned = COALESCE(p_pinned, pinned),
      updated_at = now()
    WHERE id = p_announcement_id;
    RETURN 'updated';
  ELSIF p_action = 'toggle' THEN
    UPDATE nanz_discord_announcements SET is_enabled = COALESCE(p_pinned, NOT is_enabled), updated_at = now() WHERE id = p_announcement_id;
    RETURN 'toggled';
  ELSIF p_action = 'delete' THEN
    DELETE FROM nanz_discord_announcements WHERE id = p_announcement_id;
    RETURN 'deleted';
  END IF;
  RAISE EXCEPTION 'unknown_action';
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_discord_retry(p_passkey text, p_application_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_current text;
BEGIN
  PERFORM staff_assert(p_passkey);
  SELECT discord_delivery_status INTO v_current FROM nanz_recruitment_applications WHERE id = p_application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found'; END IF;
  IF v_current = 'sent' THEN RAISE EXCEPTION 'already_delivered'; END IF;
  UPDATE nanz_recruitment_applications
  SET discord_delivery_status = 'pending', discord_delivery_error = NULL, discord_last_dispatch_at = NULL
  WHERE id = p_application_id AND discord_delivery_status <> 'sent';
  INSERT INTO nanz_application_events (application_id, event_type, actor, detail)
  VALUES (p_application_id, 'delivery_retry_queued', 'Staff', 'Retry requested via admin panel');
  RETURN 'retry_queued';
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_discord_config_read(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_discord_config_write(text, text, text, text, text, text, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_discord_channel_manage(text, text, uuid, text, text, text, text, integer, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_discord_rule_manage(text, text, uuid, text, text, text, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_discord_announcement_manage(text, text, uuid, text, text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_discord_retry(text, uuid) TO anon, authenticated;