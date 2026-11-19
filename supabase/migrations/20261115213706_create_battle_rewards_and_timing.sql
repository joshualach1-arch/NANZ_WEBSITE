/*
# Store official battle rewards and battle timing

1. New Tables
- `nanz_battle_rewards`: one row per placement-reward tier from the BIG Games API activeClanBattle endpoint.
  Each row stores the battle id, item name, best placement, worst placement, and when it was fetched.
  This lets the frontend show "what you win at each rank" directly from the game's official data.

2. Modified table
- `nanz_battle_scan_state`: add `battle_start_time` (timestamptz) and `battle_finish_time` (timestamptz)
  so the frontend can compute a real countdown from the API-provided StartTime and FinishTime.

3. Security
- RLS enabled on `nanz_battle_rewards`.
- Public visitors (anon + authenticated) can read reward rows — they are official game data, not private.
- The collector writes via the service role server-side.
*/

CREATE TABLE IF NOT EXISTS public.nanz_battle_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id text NOT NULL,
  reward_item_name text NOT NULL,
  best_place integer NOT NULL,
  worst_place integer NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (battle_id, best_place, worst_place, reward_item_name)
);

CREATE INDEX IF NOT EXISTS nanz_battle_rewards_battle_id_idx
  ON public.nanz_battle_rewards (battle_id, best_place);

ALTER TABLE public.nanz_battle_rewards ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.nanz_battle_rewards TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read battle rewards" ON public.nanz_battle_rewards;
CREATE POLICY "Public can read battle rewards"
  ON public.nanz_battle_rewards FOR SELECT
  TO anon, authenticated
  USING (true);

ALTER TABLE public.nanz_battle_scan_state
  ADD COLUMN IF NOT EXISTS battle_start_time timestamptz;

ALTER TABLE public.nanz_battle_scan_state
  ADD COLUMN IF NOT EXISTS battle_finish_time timestamptz;
