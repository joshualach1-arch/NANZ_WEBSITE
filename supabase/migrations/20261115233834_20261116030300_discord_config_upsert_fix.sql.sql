/*
# Fix Discord config write: upsert instead of update

The single config row was missing (table empty), so staff_discord_config_write
silently updated nothing. Now the function inserts the row if absent and
applies the update in one upsert.
*/

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
  INSERT INTO nanz_discord_config (id, invite_url, guild_id, guild_name, server_icon_url, recruitment_category_id, bot_endpoint, bot_api_key, notify_channel_ids)
  VALUES (true,
    CASE WHEN p_invite_url = '' THEN NULL ELSE p_invite_url END,
    CASE WHEN p_guild_id = '' THEN NULL ELSE p_guild_id END,
    CASE WHEN p_server_name = '' THEN NULL ELSE p_server_name END,
    CASE WHEN p_server_icon_url = '' THEN NULL ELSE p_server_icon_url END,
    CASE WHEN p_recruitment_category_id = '' THEN NULL ELSE p_recruitment_category_id END,
    CASE WHEN p_bot_endpoint = '' THEN NULL ELSE p_bot_endpoint END,
    CASE WHEN p_bot_api_key = '' THEN NULL ELSE p_bot_api_key END,
    COALESCE(p_notify_channel_ids, '{}'::jsonb))
  ON CONFLICT (id) DO UPDATE SET
    invite_url = CASE WHEN p_invite_url = '' THEN NULL WHEN p_invite_url IS NOT NULL THEN p_invite_url ELSE nanz_discord_config.invite_url END,
    guild_id = CASE WHEN p_guild_id = '' THEN NULL WHEN p_guild_id IS NOT NULL THEN p_guild_id ELSE nanz_discord_config.guild_id END,
    guild_name = CASE WHEN p_server_name = '' THEN NULL WHEN p_server_name IS NOT NULL THEN p_server_name ELSE nanz_discord_config.guild_name END,
    server_icon_url = CASE WHEN p_server_icon_url = '' THEN NULL WHEN p_server_icon_url IS NOT NULL THEN p_server_icon_url ELSE nanz_discord_config.server_icon_url END,
    recruitment_category_id = CASE WHEN p_recruitment_category_id = '' THEN NULL WHEN p_recruitment_category_id IS NOT NULL THEN p_recruitment_category_id ELSE nanz_discord_config.recruitment_category_id END,
    bot_endpoint = CASE WHEN p_bot_endpoint = '' THEN NULL WHEN p_bot_endpoint IS NOT NULL THEN p_bot_endpoint ELSE nanz_discord_config.bot_endpoint END,
    bot_api_key = CASE WHEN p_bot_api_key = '' THEN NULL WHEN p_bot_api_key IS NOT NULL THEN p_bot_api_key ELSE nanz_discord_config.bot_api_key END,
    notify_channel_ids = COALESCE(p_notify_channel_ids, nanz_discord_config.notify_channel_ids),
    updated_at = now();
  RETURN 'updated';
END;
$$;