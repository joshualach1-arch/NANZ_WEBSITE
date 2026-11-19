/*
# Make the public Discord config view security invoker

The nanz_discord_config_public view was created as SECURITY DEFINER (Postgres
default for views owned by a privileged role), which the security linter
flags because it bypasses row level security. The view only ever reads the
single config row's public columns, so running it as the caller is safe:
the base table is locked down (REVOKE ALL from anon/authenticated) and the
view's owner grants SELECT on the view itself.
*/

ALTER VIEW public.nanz_discord_config_public SET (security_invoker = true);