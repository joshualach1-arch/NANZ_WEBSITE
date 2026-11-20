-- BIG Games trade/booth history idempotency key.
-- The Edge Function upserts on (collector_no, external_transaction_key, pet_id, variant).
ALTER TABLE public.vault_acquisitions
  ADD COLUMN IF NOT EXISTS external_transaction_key text;

CREATE UNIQUE INDEX IF NOT EXISTS vault_acquisitions_external_transaction_unique
  ON public.vault_acquisitions (collector_no, external_transaction_key, pet_id, variant)
  WHERE external_transaction_key IS NOT NULL;
