# NANZO SIGNED VAULT — Audit & Implementation Plan (Development Task 01)

Status: IMPLEMENTED — all 4 phases shipped 2026-11-19. See "Implementation status" at the bottom.

---

## PART 1 — Project audit (verified against the codebase, not assumed)

| # | Area | Finding |
|---|------|---------|
| 1 | Frontend | React 18.3 + TypeScript 5.5, Vite 7.3. Single-page app with NO router library — navigation is state-based (`useState<Section>` in `src/App.tsx`), plus two legacy hacks: `#admin` hash for staff mode and a `pathname.match(/^\/player\/(\d+)/)` deep link. |
| 2 | Backend | Supabase: Postgres + RLS + 5 Edge Functions (Deno runtime): `nanz-ranking`, `nanz-intelligence`, `nanz-awards`, `nanz-discord-bridge`, `roblox-avatars`. All `verify_jwt = false`, manual CORS header set, service-role DB access. |
| 3 | Languages | TypeScript (React frontend, Deno functions), SQL (28 migrations). |
| 4 | Structure | `src/App.tsx` (756 lines, main shell), `src/components/*` (9 feature components), `src/lib/supabase.ts` (client + types), per-feature CSS files, `supabase/migrations/`, `supabase/functions/`. |
| 5 | Database provider | Supabase Postgres. 41 tables in `public`, **all RLS-enabled**. |
| 6 | Schema | Battle rankings/snapshots/state, members, achievements/awards/reputation, goals/missions, rival intelligence + alerts, Discord config/rules/announcements/channels/link-logs, applications + events, notifications, module status, hall of fame, player connections, clan config, staff config. |
| 7 | Authentication | **No Supabase Auth anywhere.** The site is fully anonymous. Staff access = shared passkey stored in `nanz_staff_config`, verified by SECURITY DEFINER RPCs (`staff_verify` / `staff_assert`); passkey held in `sessionStorage`; owner bootstrap via `staff_passkey_replace` (EXECUTE granted to `service_role` only, gated by the `NANZ_STAFF_PASSKEY` server secret). |
| 8 | User management | `nanz_members` keyed by `roblox_user_id` — Roblox identities, not login accounts. |
| 9 | Authorization architecture | Public read via RLS policies; all writes through passkey-gated SECURITY DEFINER RPCs; edge functions hold service role; EXECUTE revoked from PUBLIC on sensitive functions. |
| 10 | Routing | None (see #1). Adding `/signed-vault` must not touch the state-based shell. |
| 11 | Navigation | Top nav bar + mobile drawer driven by the `Section` union type. |
| 12 | Reusable components | `LogoMark`, `AvatarImage`, `Pill`, `SectionHeader`, `useLiveData`, `useCountdown`, modal patterns, card/pill/btn CSS classes. |
| 13 | Styling | Tailwind is installed but the real UI is hand-written CSS per feature (7 CSS files, ~1,550 lines) built on CSS custom properties. |
| 14 | Design tokens | `--bg #000`, surfaces `#1c1c1e/#2c2c2e/#3a3a3c`, text `#f5f5f7→#636366`, accents `--blue #0a84ff`, `--pink #ff375f`, `--gold #ffd60a`, `--green #30d158`, `--orange`, `--purple`, `--cyan`. Inter font, weights ≤ 800. Glassy nav (backdrop-blur), 0.5px separators, 8/12/16px radii. |
| 15 | Icons | lucide-react only. |
| 16 | Images | `public/images/{rewards,clan}` static assets; Roblox avatars fetched via `roblox-avatars` edge function, cached in `nanz_roblox_avatars`. |
| 17 | API integrations | BIG Games **legacy** API `https://ps99.biggamesapi.io` (`/api/activeClanBattle`, `/api/clan/:name`) — already in production use. Roblox `users.roblox.com/v1` + thumbnails. Discord via self-hosted bot endpoint (`nanz_discord_config.bot_endpoint`) + discord.com API. |
| 18 | Environment | Client: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Server secrets managed via Supabase (e.g. `NANZ_STAFF_PASSKEY`, Discord bot endpoint/key). |
| 19 | Hosting | Bolt deploy → `https://nanz-clan.com` (static SPA; OG metadata already in `index.html`). Edge functions deployed via the Supabase MCP deploy tool. |
| 20 | Scheduled jobs | **No cron.** Sync is client-driven: browser timers invoke edge functions every 30–60s; concurrency guarded by `nanz_intelligence_lock` and `sync_lock_until` columns. |

## PART 2 — Preservation guarantees

- `main.tsx` will gain a single path check: if `window.location.pathname` starts with `/signed-vault`, mount `SignedVaultApp`; otherwise mount the existing `App` unchanged. The existing homepage, sections, components, CSS, auth (staff passkey), branding and DB schema are untouched.
- No existing table is altered; the vault adds a new `vault_*` table namespace.
- No new top-level navigation entry is required for the main site (the vault is reached by URL and optionally one drawer link — owner's choice).

## PART 3 — Route & internal navigation

Route `/signed-vault` (internal sub-views, state-based like the main site, with `history.pushState` so refresh/back works):

1. Overview (dashboard)
2. My Collection
3. Missing Pets
4. Signer Database (gallery + signer detail)
5. Acquisition History
6. Cosmic Value Tracker
7. Verification
8. Settings

## PART 4 — Two-collector model

- `vault_collectors`: exactly 2 rows (fixed by CHECK), `collector_no` 1/2, `is_owner` flag, Roblox account binding, display label.
- Collections are keyed by `collector_id` everywhere; **no view, RPC or UI ever joins across collectors' inventory**. Shared read-only data: pet catalog, signer database, signature records, pet images, cosmic values, categories, verification info.
- Owner (collector 1): manages both collections + settings. Collector 2: only their own collection; cannot touch owner permissions or settings — enforced server-side (see security model).

## PART 5 — Design

Reuse the NANZO token system (black background, glass surfaces, blue/pink/gold accents, Inter, pill buttons, 0.5px separators). Vault-specific premium touches: gold-accent "collector" tier styling, a distinct vault lock-screen, gem/diamond motifs for values — all built from existing CSS variables plus a small `signed-vault-styles.css`. No new visual identity.

## PART 6 — Technical architecture

### Security model (consistent with the existing passkey architecture — no Supabase Auth)

1. Two vault passkeys (owner / collector 2), stored hashed in `vault_access_config`, settable only via service-role bootstrap from a server secret (mirrors `staff_passkey_replace`).
2. A successful passkey check returns a **vault session token** (random 32-byte, stored hashed, 7-day expiry, collector scope recorded). Stored in `sessionStorage` client-side.
3. **Every vault read/write goes through SECURITY DEFINER RPCs of the shape `vault_* (p_session_token, ...)`.** The RPC resolves the token → collector scope and enforces it in SQL. Data tables get **no anon policies** (RLS on, zero policies → deny-all), so a leaked anon key reads nothing.
4. All vault mutations write to `vault_audit_log`.
5. Edges functions use the service role for OAuth token storage and inventory sync only.

### Database (new, all RLS-enabled, deny-all by default)

`vault_collectors`, `vault_access_config`, `vault_sessions`, `vault_settings`,
`vault_pet_catalog` (shared), `vault_signers` (shared), `vault_signatures` (shared),
`vault_pets` (per-collector inventory rows), `vault_acquisitions` (per-collector),
`vault_value_snapshots` (per-collector portfolio value over time),
`vault_cosmic_values` (shared cache), `vault_verification_requests`,
`vault_oauth_tokens` (service-role only), `vault_audit_log`.

### Services

- **Authorization service** — passkey → session token RPCs (`vault_login`, `vault_session_check`).
- **Roblox account service** — resolves/validates collector Roblox accounts (reuses `roblox-avatars` patterns).
- **BIG Games OAuth adapter** — edge function `vault-oauth`: builds authorize URL (PKCE S256 + state stored server-side), handles `/signed-vault/callback` redirect, exchanges code at `https://db.biggames.io/oauth/token` (HTTP Basic auth), stores access token + expiry per collector.
- **Inventory scanner** — edge function `vault-inventory`: calls `GET https://ps99.biggamesapi.io/v1/account/inventory` with the stored bearer token, normalizes items, writes `vault_pets`, diffes against previous snapshot to create `vault_acquisitions`.
- **Pet classification service** — inside the scanner: class `Pet` filter, golden/rainbow/shiny flags from `rawData.pt`/`sh`, signed-pet detection from rawData signature fields (to be confirmed against a real payload before schema lock).
- **Signer service** — signer CRUD + signature records linking pets to signers.
- **Cosmic Values adapter** — edge function `vault-values` with pluggable source (see feasibility).
- **Value history service** — periodic portfolio value snapshots per collector.

### External API feasibility (verified 2026-11-19 against official docs)

1. **Roblox public user profile API** — available (`users.roblox.com/v1/users`, `/usernames/users`); already used in production by this project.
2. **Roblox thumbnail API** — available (`thumbnails.roblox.com`); already used via the `roblox-avatars` function.
3. **BIG Games developer API** — **confirmed real.** Official docs repo `BIG-Games-LLC/ps99-public-api-docs`. v1 namespace `https://ps99.biggamesapi.io/v1/`; legacy `/api/` namespace (already in use) remains fully supported.
4. **BIG Games OAuth** — **confirmed, and the previously discussed scope EXISTS verbatim:** `player-data:pet-simulator-99:inventory:read` unlocks `GET /v1/account/inventory`. Also available: `profile:read`, `extendedProfile:read`, `itemIndex:read`, `trades:read`, `booth:read`, `mail:read` (mail = gift records — directly useful for signed-pet provenance). Flow: Authorization Code + PKCE S256 at `db.biggames.io/oauth/authorize`; token exchange at `db.biggames.io/oauth/token` with Basic `client_id:client_secret`; **tokens last 30 days with NO refresh endpoint** — re-authorization required; players can revoke anytime. Requires registering a developer app at db.biggames.io with an exact-match redirect URI.
   - ⚠ Action needed by the owner: register the developer app (app name + redirect URI `https://nanz-clan.com/signed-vault/callback` + scopes) and provide client_id/secret as Supabase secrets.
   - Rate limits: `/v1/account/*` has per-minute limits plus a **daily refresh quota** for fresh save pulls (cached snapshots otherwise). Scanner must respect `Retry-After` and cache aggressively.
5. **PS99 inventory access** — via the OAuth endpoint above. Response gives `items[]` (`class: "Pet"`, `id`, `count`, `rawData` with `pt` (golden/rainbow), `sh` (shiny), `createdAt`), plus RAP, exists counts, rarity, equipped loadout, `fetchedAt`. Signed-pet identification must be validated against a real token's payload before the schema is locked (rawData carries signature state; exact field to be confirmed in Phase 3 with a live authorized scan — the schema keeps a `raw_data jsonb` column so no migration is needed later).
6. **Cosmic Values** — **no official API found.** The site (`petsimulatorvalues.com`) is a server-rendered value list without documented public endpoints; official access channels are the website and their Discord bot. Design decision: modular adapter with three sources —
   - **A (default, reliable): owner-managed values** — manual entry / CSV paste of cosmic values per pet, stored in `vault_cosmic_values` with `source: 'manual'` and update timestamps.
   - **B (optional, unofficial): page-scrape adapter** in the edge function against `values.php?category=...` with caching and graceful failure — flagged unofficial, may break, deprioritized.
   - **C: BIG Games official item/RAP data** (`db.biggames.io` / legacy `/api/` endpoints) as an automated baseline value feed, with cosmic values as the curated overlay.

### Environment variables / secrets needed

- `BIG_GAMES_CLIENT_ID`, `BIG_GAMES_CLIENT_SECRET` (edge-function secrets only — never exposed to the browser).
- Vault owner/collector bootstrap secret (e.g. `VAULT_OWNER_SETUP_KEY`) for first-time passkey setup, mirroring `NANZ_STAFF_PASSKEY`.
- No new client-side env vars.

### Dependencies

- None required. No router library (path gate + `pushState` matches existing conventions); no icon/UI additions beyond lucide-react.

## PART 7 — Implementation plan

### Phase 1 — Foundation (first build after approval)
- `main.tsx` path gate + `SignedVaultApp` shell with internal nav, lock screen, access-denied screen.
- Migration: all `vault_*` tables, RLS deny-all, session/authorization RPCs, audit logging, collector bootstrap RPCs.
- Settings page (passkey setup flow, collector profiles).

### Phase 2 — Catalog & manual collection
- Pet catalog + signer database (gallery + detail), manual collection entry (add/edit/remove pets, purchase price, acquisition date, signer link), collection grid + missing-pets view (catalog diff), overview dashboard with per-collector stats.

### Phase 3 — BIG Games integration
- OAuth connect flow + callback, inventory scanner, classification, acquisition detection, auto-sync scheduling (respecting rate limits), verification panel.

### Phase 4 — Values & polish
- Cosmic value tracker (manual-first adapter), value snapshots + charts, acquisition history timeline polish, responsive/mobile pass, end-to-end authorization tests.

### Risks

| Risk | Mitigation |
|------|-----------|
| OAuth app must be registered by the owner at db.biggames.io | Phase 3 blocked until client_id/secret provided; Phases 1–2 unaffected |
| 30-day token expiry, no refresh | Re-connect banner + one-click re-auth per collector |
| Daily refresh quota limits scan frequency | Cached snapshots + scan throttling + visible freshness indicators |
| Signed-pet rawData shape unverified | `raw_data jsonb` column preserves everything; schema locked only after first live scan |
| No official Cosmic Values API | Manual-first values (A) + optional unofficial adapter (B), clearly labeled |
| BigInt RAP values exceed safe integer range | Store as `numeric`/string in DB; format client-side |
| Token leakage | Hashed at rest, 7-day expiry, server-side only state/verifier, audit log |

### Testing strategy

- `npm run build` + `typecheck` after every phase.
- SQL-level RPC tests: correct-passkey login, wrong passkey, expired token, collector-2 attempting owner RPC, cross-collector read attempt (must all fail).
- Edge function dry-runs with a real token; negative tests for 401/403/429 handling.
- UI verification of all 8 sub-views on desktop + mobile widths; existing site regression (all 13 sections still render, application flow still submits).

## PART 8 — Implementation status (2026-11-19)

All four phases are built and deployed.

- **Migrations applied:** `20261119000000_create_signed_vault_foundation` (14 `vault_*` tables, deny-all RLS, `REVOKE ALL` from anon/authenticated, seeded 2 collectors + 2 access configs + settings; RPCs `vault_hash_secret`, `vault_login`, `vault_session`, `vault_logout`, `vault_assert_session`, `vault_setup`, `vault_purge_expired_sessions`), `20261119010000_create_signed_vault_data_rpcs` (`vault_data_get`, `vault_catalog_manage`, `vault_signer_manage`, `vault_collection_manage`, `vault_settings_manage`, `vault_passkey_change`), `20261119020000_add_vault_status_rpc` (`vault_status`), `20261119030000_add_vault_biggames_integration` (`vault_oauth_states`, `vault_sync_state`, `vault_oauth_state_set/claim`, `vault_oauth_save`, `vault_oauth_status`, `vault_oauth_disconnect`, `vault_sync_apply`).
- **Edge functions deployed:** `vault-bridge` (status/setup/login/session/logout/data/manage dispatch, param whitelist, token injection) and `vault-biggames` (oauth_start with PKCE S256 + https origin check, oauth_callback with atomic state claim + Basic-auth token exchange, sync with 401/403/429 + Retry-After handling). Both `verify_jwt = false`, full CORS on every response.
- **Frontend:** `main.tsx` path gate mounts `SignedVaultApp` for `/signed-vault*`; `/signed-vault/callback` handled before session UI. All 8 tabs implemented in `SignedVaultApp.tsx` with `vaultApi.ts` (types, friendly error mapping, sessionStorage token) and `BigGamesConnect.tsx`.
- **Verification done:** typecheck + `npm run build` green (only pre-existing chunk-size warning). DB negative tests passed in a rolled-back transaction: wrong setup key → `vault_setup_denied`; login before setup → `vault_access_denied`; wrong passkey, invalid/expired token, collector-2 owner-RPC attempt, invalid sync payload all rejected; positive full flow (setup → both logins → owner data read → owner-only denial for collector 2) passed; after the transaction the setup flag returned to "pending".
- **Still required before first use (owner actions, not code):**
  1. Add edge-function secret `VAULT_SETUP_KEY` (any long random string) — the first-run setup screen refuses with a clear message until it exists. It is only needed once; afterwards it only guards re-running setup.
  2. Register the BIG Games developer app at db.biggames.io (redirect URI `https://nanz-clan.com/signed-vault/callback`, scope `player-data:pet-simulator-99:inventory:read`) and add secrets `BIG_GAMES_CLIENT_ID` + `BIG_GAMES_CLIENT_SECRET`. Until then the Connect button in Settings reports "OAuth is not configured yet".
- **First-run flow:** open `/signed-vault` → setup screen (choose both passkeys, ≥ 10 chars) → lock screen → passkey login. Passkeys can be changed in Settings; sessions last 7 days and are purged automatically.
