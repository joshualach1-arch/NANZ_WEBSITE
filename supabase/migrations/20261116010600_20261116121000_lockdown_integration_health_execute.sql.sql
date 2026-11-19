/*
# Lock down staff_discord_integration_health to service_role

The Discord admin panel calls this through the nanz-discord-bridge edge
function pattern (service role server-side), not directly from the
browser. Follow the security advisor: revoke EXECUTE from anon and
authenticated, keep it for service_role only. Same tightening applied
as a migration so it is part of the persistent schema record.
*/

REVOKE EXECUTE ON FUNCTION public.staff_discord_integration_health(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_discord_integration_health(text) TO service_role;