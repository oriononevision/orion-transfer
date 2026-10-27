-- ORION TRANSFER — stockage Supabase uniquement (Cloudflare R2 abandonné).
--
-- 1. Limites adaptées à l'offre gratuite de Supabase : 50 Mo maximum par
--    fichier, 1 Go de stockage pour tout le projet. Pour les relever (offre
--    Pro), modifier cette fonction ET `LIMITS` dans
--    supabase/functions/_shared/fileRules.ts, ainsi que la limite du bucket.
-- 2. Création du bucket privé `orion-transfer` (aucun accès public : les
--    fichiers ne sortent que par des liens signés de courte durée, créés par
--    les fonctions serveur après vérification des droits).

create or replace function transfer.limits()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'max_file_bytes',        52428800,    -- 50 Mo (maximum de l'offre gratuite Supabase)
    'max_transfer_bytes',    524288000,   -- 500 Mo
    'max_files',             20,
    'max_recipients',        20,
    'max_active_bytes',      524288000,   -- 500 Mo de stockage actif par utilisateur
    'max_transfers_per_day', 20,
    'expiry_days',           jsonb_build_array(1, 7, 14),
    'default_expiry_days',   7,
    'max_message_chars',     2000
  );
$$;

grant execute on function transfer.limits() to authenticated, service_role;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('orion-transfer', 'orion-transfer', false, 52428800)
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit;
  end if;
end $$;
