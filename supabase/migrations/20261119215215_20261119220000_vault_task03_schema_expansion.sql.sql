/*
# Signed Vault — Task 03: catalog/signatures/values schema expansion

1. Extended Tables (ADD COLUMN only — no drops, no type changes)
- vault_pet_catalog: external_id (BIG Games configName), display_name, variant, signability
  ('signable'|'not_signable'|'unknown'|'needs_review', default 'unknown'), signability_source,
  signability_verified_at, is_huge/is_exclusive/is_titanic/is_gargantuan, data_source,
  import_batch_id, has_expected columns preserved.
- vault_signers: display_name, profile_url, youtube_channel_id/name/url/avatar, youtube_subscribers,
  is_developer/is_partner/is_creator, verification_status ('verified'|'community_verified'|'unverified'|'needs_review'),
  data_source, roblox_resolved_at.
- vault_signatures: cosmic_signature_id, signature_name, signature_value, verification_status
  (same enum), source, verified_at, verified_by, updated_at.
- vault_cosmic_values: signature_value, combined_value, currency, calculation_method,
  verification_status, value_timestamp.

2. New Tables
- vault_signer_roles(signer_id, role) — multiple roles per signer (developer, partner, youtuber, ...).
- vault_signer_socials(signer_id, platform, platform_user_id, url, verified, source).
- vault_value_history(pet_id, signature_id, pet_value, signature_value, combined_value, source, captured_at)
  — our own snapshot series; Cosmic provides no history, so we collect from first import.
- vault_import_history(kind, source, added, updated, skipped, details, started_at, finished_at).

3. Security: RLS on every new table; deny-all to client roles (vault pattern: access via
  SECURITY DEFINER RPCs only).
*/

ALTER TABLE vault_pet_catalog
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS variant text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS signability text NOT NULL DEFAULT 'unknown'
    CHECK (signability IN ('signable','not_signable','unknown','needs_review')),
  ADD COLUMN IF NOT EXISTS signability_source text,
  ADD COLUMN IF NOT EXISTS signability_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_huge boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_exclusive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_titanic boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_gargantuan boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS import_batch_id uuid;

CREATE INDEX IF NOT EXISTS vault_pet_catalog_external_id_idx ON vault_pet_catalog (external_id);

ALTER TABLE vault_signers
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS profile_url text,
  ADD COLUMN IF NOT EXISTS youtube_channel_id text,
  ADD COLUMN IF NOT EXISTS youtube_channel_name text,
  ADD COLUMN IF NOT EXISTS youtube_channel_url text,
  ADD COLUMN IF NOT EXISTS youtube_avatar_url text,
  ADD COLUMN IF NOT EXISTS youtube_subscribers bigint,
  ADD COLUMN IF NOT EXISTS is_developer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_partner boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_creator boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('verified','community_verified','unverified','needs_review')),
  ADD COLUMN IF NOT EXISTS data_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS roblox_resolved_at timestamptz;

ALTER TABLE vault_signatures
  ADD COLUMN IF NOT EXISTS cosmic_signature_id text,
  ADD COLUMN IF NOT EXISTS signature_name text,
  ADD COLUMN IF NOT EXISTS signature_value numeric,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('verified','community_verified','unverified','needs_review')),
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE vault_cosmic_values
  ADD COLUMN IF NOT EXISTS signature_value numeric,
  ADD COLUMN IF NOT EXISTS combined_value numeric,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'gems',
  ADD COLUMN IF NOT EXISTS calculation_method text,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('verified','community_verified','unverified','needs_review')),
  ADD COLUMN IF NOT EXISTS value_timestamp timestamptz;

-- ── new tables ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vault_signer_roles (
  signer_id uuid NOT NULL REFERENCES vault_signers(id) ON DELETE CASCADE,
  role text NOT NULL,
  PRIMARY KEY (signer_id, role)
);

CREATE TABLE IF NOT EXISTS vault_signer_socials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_id uuid NOT NULL REFERENCES vault_signers(id) ON DELETE CASCADE,
  platform text NOT NULL,
  platform_user_id text,
  url text,
  verified boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signer_id, platform)
);

CREATE TABLE IF NOT EXISTS vault_value_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id uuid REFERENCES vault_pet_catalog(id) ON DELETE CASCADE,
  signature_id uuid REFERENCES vault_signatures(id) ON DELETE CASCADE,
  pet_value numeric,
  signature_value numeric,
  combined_value numeric,
  source text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vault_value_history_pet_idx ON vault_value_history (pet_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS vault_import_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('catalog','cosmic','signer')),
  source text NOT NULL,
  added integer,
  updated integer,
  skipped integer,
  details jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- ── lockdown ───────────────────────────────────────────────────────

ALTER TABLE vault_signer_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_signer_socials ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_value_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_import_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON vault_signer_roles FROM anon, authenticated;
REVOKE ALL ON vault_signer_socials FROM anon, authenticated;
REVOKE ALL ON vault_value_history FROM anon, authenticated;
REVOKE ALL ON vault_import_history FROM anon, authenticated;