/*
# Grant SELECT on the config row id column for the invoker view

The security-invoker view filters WHERE id = true, so the calling role
needs SELECT on the id column as well. id is a boolean row marker with no
sensitivity.
*/

GRANT SELECT (id) ON public.nanz_discord_config TO anon, authenticated;