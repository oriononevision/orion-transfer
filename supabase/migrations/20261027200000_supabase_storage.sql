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

-- ---------------------------------------------------------------------------
-- Suggestions de destinataires : version resserrée de search_contacts
-- ---------------------------------------------------------------------------
-- * Un nom n'est affiché que pour une personne qui m'a déjà envoyé un
--   transfert (elle s'est fait connaître) ; pour les adresses que j'ai
--   saisies moi-même, seule l'adresse revient. On ne peut donc pas savoir si
--   quelqu'un possède un compte ORION.
-- * Aucun identifiant de compte n'est renvoyé (colonne id toujours vide).
-- * Les transferts reçus ne comptent que s'ils sont rattachés à mon compte
--   (adresse vérifiée), publiés et non retirés.

create or replace function transfer.search_contacts(p_query text default '', p_limit integer default 12)
returns table (id uuid, email text, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select auth.uid() as uid
  ),
  sent_to as (
    select lower(r.email) as email, null::text as display_name, max(t.created_at) as last_at
    from transfer.recipients r
    join transfer.transfers t on t.id = r.transfer_id
    where t.sender_id = (select uid from me)
      and t.status <> 'deleted'
    group by lower(r.email)
  ),
  received_from as (
    select lower(u.email) as email,
           nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as display_name,
           max(t.created_at) as last_at
    from transfer.recipients r
    join transfer.transfers t on t.id = r.transfer_id
    join auth.users u on u.id = t.sender_id
    left join public.profiles p on p.id = t.sender_id
    where r.user_id = (select uid from me)
      and r.revoked_at is null
      and t.status in ('ready', 'expired')
      and t.sender_id <> (select uid from me)
    group by lower(u.email), p.first_name, p.last_name
  ),
  contacts as (
    select c.email,
           max(c.display_name) as display_name,
           max(c.last_at) as last_at
    from (select * from sent_to union all select * from received_from) c
    where c.email is not null and c.email <> ''
    group by c.email
  ),
  q as (
    select nullif(lower(btrim(coalesce(p_query, ''))), '') as term,
           least(greatest(coalesce(p_limit, 12), 1), 20) as lim
  )
  select null::uuid, c.email, c.display_name
  from contacts c, q
  where (select uid from me) is not null
    and (q.term is null or c.email ilike '%' || q.term || '%' or coalesce(c.display_name, '') ilike '%' || q.term || '%')
  order by c.last_at desc, c.email
  limit (select lim from q);
$$;

revoke all on function transfer.search_contacts(text, integer) from public, anon;
grant execute on function transfer.search_contacts(text, integer) to authenticated, service_role;
