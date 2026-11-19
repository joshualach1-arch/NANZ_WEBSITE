/*
# NANZO SIGNED VAULT — status lookup

## 1. Plain-English summary
Adds `vault_status()`, a public RPC used by the vault lock screen to
show whether first-time setup is still pending. It returns no secret
material — only two booleans.

## 2. Function
- `vault_status()` — returns (setup_required, session_count).
  `setup_required` is true while either collector still has no passkey.
  `session_count` is informational.

## 3. Security
- SECURITY DEFINER, EXECUTE to anon + authenticated. Reads only the
  locked config tables; returns no hashes, no tokens, no collector
  identities.
*/

create or replace function public.vault_status()
returns table (out_setup_required boolean, out_session_count bigint)
language sql
security definer
set search_path = public, extensions
as $$
  select
    coalesce(bool_or(a.setup_required), true),
    (select count(*) from public.vault_sessions where revoked_at is null and expires_at > now())
  from public.vault_access_config a;
$$;

grant execute on function public.vault_status() to anon, authenticated;
