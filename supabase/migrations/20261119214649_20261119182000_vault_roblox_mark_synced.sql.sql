/*
# Signed Vault — expose roblox accounts + mark synced (Task 02 follow-up)

1. New function `vault_roblox_mark_synced(p_collector_no)` — service-role only; the inventory
   scanner stamps `last_synced_at` on the connected Roblox account after a successful scan.
2. `vault_data_get` extended: adds `roblox_accounts` (both rows, minimal fields). A collector
   sees their own connection in full; the owner sees both. Second collector sees the owner's
   row only with public fields (username, display name, avatar) — matching the shared-info rule.
3. `vault_oauth_status` unchanged; the disconnect path in vault_roblox_apply already clears tokens.
*/

CREATE OR REPLACE FUNCTION vault_roblox_mark_synced(p_collector_no smallint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF p_collector_no NOT IN (1, 2) THEN RAISE EXCEPTION 'vault_invalid_collector'; END IF;
  UPDATE vault_roblox_accounts
     SET last_synced_at = now(), updated_at = now()
   WHERE collector_no = p_collector_no AND connection_status = 'connected';
END;
$$;

REVOKE ALL ON FUNCTION vault_roblox_mark_synced(smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault_roblox_mark_synced(smallint) TO service_role;