/*
# Create Roblox avatar cache table

1. New Tables
- `nanz_roblox_avatars`
  - `username` (text, primary key) — Roblox username as used in the clan roster
  - `roblox_user_id` (bigint) — numeric Roblox user ID resolved from the username
  - `avatar_url` (text) — cached headshot thumbnail URL from Roblox thumbnails API
  - `display_name` (text, nullable) — Roblox display name if available
  - `fetched_at` (timestamptz) — when the avatar was last refreshed
  - `status` (text) — 'verified' (avatar found), 'not_found' (user does not exist), 'error' (fetch failed)
2. Security
- Enable RLS on `nanz_roblox_avatars`.
- Grant SELECT to `anon, authenticated` so the frontend can read cached avatars.
- Grant INSERT, UPDATE to `service_role` so the edge function can write cache entries.
- No DELETE policies — cache entries are upserted only.
3. Notes
- This is a single-tenant public cache. All avatars are publicly visible Roblox profile pictures, so read access is intentionally open.
- The edge function uses the service role key to upsert, bypassing RLS.
*/

CREATE TABLE IF NOT EXISTS nanz_roblox_avatars (
  username text PRIMARY KEY,
  roblox_user_id bigint,
  avatar_url text,
  display_name text,
  fetched_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'verified'
);

ALTER TABLE nanz_roblox_avatars ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON nanz_roblox_avatars TO anon, authenticated;
GRANT INSERT, UPDATE ON nanz_roblox_avatars TO service_role;

DROP POLICY IF EXISTS "anon_read_avatars" ON nanz_roblox_avatars;
CREATE POLICY "anon_read_avatars" ON nanz_roblox_avatars
  FOR SELECT TO anon, authenticated USING (true);
