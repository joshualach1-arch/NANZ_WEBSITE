/*
# Add updated_at timestamps for archive and missions

The intelligence collector updates `nanz_battle_archive` and `nanz_missions` rows and
records the update time. Both tables were missing an `updated_at` column.

## 1. Modified Tables
- `nanz_battle_archive`: add `updated_at timestamptz DEFAULT now()`.
- `nanz_missions`: add `updated_at timestamptz DEFAULT now()`.
## 2. Security
- No policy changes.
*/

ALTER TABLE public.nanz_battle_archive ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.nanz_missions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();