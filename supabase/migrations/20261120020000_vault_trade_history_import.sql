-- Import idempotent BIG Games trade and booth history into the existing
-- acquisition ledger. Prices stay NULL unless the trade payload explicitly
-- contains a Diamonds item; booth history does not publish its diamond amount.
ALTER TABLE public.vault_acquisitions
  ADD COLUMN IF NOT EXISTS external_transaction_key text;

CREATE UNIQUE INDEX IF NOT EXISTS vault_acquisitions_external_tx_unique
  ON public.vault_acquisitions (collector_no, external_transaction_key, pet_id, variant);

COMMENT ON COLUMN public.vault_acquisitions.external_transaction_key IS
  'Stable hash of the BIG Games trade/booth transaction and received pet; used to prevent duplicate imports.';
