CREATE TABLE IF NOT EXISTS public.vault_cosmic_import_progress (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status text NOT NULL DEFAULT 'idle',
  stage text,
  category text,
  category_index integer NOT NULL DEFAULT 0,
  category_total integer NOT NULL DEFAULT 4,
  page integer NOT NULL DEFAULT 0,
  pages_total integer,
  source_rows integer NOT NULL DEFAULT 0,
  message text,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vault_cosmic_import_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vault_cosmic_import_progress FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.vault_cosmic_import_progress TO service_role;
NOTIFY pgrst, 'reload schema';
