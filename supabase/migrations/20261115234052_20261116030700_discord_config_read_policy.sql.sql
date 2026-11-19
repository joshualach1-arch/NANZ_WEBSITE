/*
# Public read policy for the Discord config row

With the view now running as the caller (security_invoker), the base
table's RLS applies. A SELECT policy on nanz_discord_config lets
anon/authenticated read the row, while the column grants from the previous
migrations ensure they can only ever SEE invite_url, guild_id, guild_name,
server_icon_url and the row id — the private columns (bot API key, bot
endpoint, recruitment category, health data, webhook URL, role mapping)
remain non-selectable for these roles.
*/

DROP POLICY IF EXISTS "discord_config_public_read" ON public.nanz_discord_config;
CREATE POLICY "discord_config_public_read" ON public.nanz_discord_config
  FOR SELECT TO anon, authenticated
  USING (id = true);