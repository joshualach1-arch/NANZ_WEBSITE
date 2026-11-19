/*
# Intelligence collector lock

Small single-row lock table so concurrent visitors triggering the rival/goal/archive
collector do not duplicate BIG Games API requests. The collector claims the lock
conditionally; a stale lock is reclaimable after its expiry.

## 1. New Tables
- `nanz_intelligence_lock`: id (always true), locked_until timestamptz.
## 2. Security
- RLS enabled, no anon/authenticated grants needed (service_role only via edge function).
*/

CREATE TABLE IF NOT EXISTS public.nanz_intelligence_lock (
  id boolean PRIMARY KEY DEFAULT true,
  locked_until timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.nanz_intelligence_lock (id, locked_until) VALUES (true, now() - interval '1 hour') ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.nanz_intelligence_lock ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.nanz_intelligence_lock TO service_role;