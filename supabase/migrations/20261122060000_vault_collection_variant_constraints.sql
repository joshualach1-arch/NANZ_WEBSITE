-- Extend collection and signature constraints for Cosmic-style variants.
alter table public.vault_pets drop constraint if exists vault_pets_variant_check;
alter table public.vault_pets add constraint vault_pets_variant_check
  check (variant in ('normal','golden','rainbow','shiny','golden_shiny','rainbow_shiny'));

alter table public.vault_signatures drop constraint if exists vault_signatures_variant_check;
alter table public.vault_signatures add constraint vault_signatures_variant_check
  check (variant in ('normal','golden','rainbow','shiny','golden_shiny','rainbow_shiny'));

notify pgrst, 'reload schema';
