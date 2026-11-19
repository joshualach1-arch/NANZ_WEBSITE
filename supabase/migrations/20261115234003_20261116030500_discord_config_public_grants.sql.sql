/*
# Grant the invoker view access to the base table

With security_invoker = true, the view now runs as the calling role, so
anon/authenticated need SELECT on the underlying columns of
nanz_discord_config that the view exposes (invite/guild/name/icon only).
The remaining private columns are NOT granted — column-level grants keep
the bot API key, endpoint, category id and health fields unreachable.
*/

GRANT SELECT (invite_url, guild_id, guild_name, server_icon_url)
  ON public.nanz_discord_config TO anon, authenticated;