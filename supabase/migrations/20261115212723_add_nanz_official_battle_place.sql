/*
# Store the API-reported NANZ battle place

1. Modified table
- `nanz_battle_scan_state.official_battle_place`: the current battle placement reported inside the NANZ clan profile for the matching active battle ID.

2. Data integrity
- This value is kept separate from `rank_within_scanned_clans`, which is calculated from the collector's verified candidate set.
- The frontend can show the API-reported place without mislabeling a partial scan as a global ranking.

3. Security
- Existing RLS and grants remain unchanged.
*/

ALTER TABLE public.nanz_battle_scan_state
  ADD COLUMN IF NOT EXISTS official_battle_place integer;
