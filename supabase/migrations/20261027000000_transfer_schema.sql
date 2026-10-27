-- ORION TRANSFER — schéma de base
--
-- Toutes les tables de TRANSFER vivent dans le schéma `transfer`, séparé de
-- `public` (utilisé par ORION CORE et le site). Les comptes sont ceux de
-- Supabase Auth (`auth.users`), partagés avec CORE.
--
-- Principes :
--   * Le navigateur ne peut QUE lire (et seulement ce que les règles RLS
--     autorisent). Toute écriture passe par des fonctions `security definer`
--     qui vérifient elles-mêmes l'identité, les droits et les limites.
--   * Les fichiers ne sont jamais stockés dans la base : seulement leurs
--     métadonnées et une clé de stockage aléatoire (bucket R2 privé).
--   * Les clés de stockage et l'identifiant de compte des destinataires ne
--     sont jamais lisibles par le navigateur (droits par colonne).
--
-- Après application sur Supabase :
--   * Settings → API → Exposed schemas : ajouter `transfer`.
--   * Database → Extensions : activer `pg_cron` pour l'expiration automatique
--     (la planification ci-dessous est ignorée si l'extension est absente).

create schema if not exists transfer;

revoke all on schema transfer from public;
grant usage on schema transfer to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Limites de la bêta (une seule source de vérité côté serveur)
-- ---------------------------------------------------------------------------

create or replace function transfer.limits()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'max_file_bytes',        262144000,   -- 250 Mo
    'max_transfer_bytes',    1073741824,  -- 1 Go
    'max_files',             20,
    'max_recipients',        20,
    'max_active_bytes',      2147483648,  -- 2 Go de stockage actif par utilisateur
    'max_transfers_per_day', 20,
    'expiry_days',           jsonb_build_array(1, 7, 14),
    'default_expiry_days',   7,
    'max_message_chars',     2000
  );
$$;

-- Extensions refusées (première barrière ; le contenu réel est vérifié
-- par la fonction d'envoi après le dépôt du fichier).
create or replace function transfer.blocked_extensions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'exe','msi','msp','msix','appx','scr','com','pif','cpl','dll','sys',
    'bat','cmd','ps1','psm1','vbs','vbe','wsf','wsh','hta','reg','lnk',
    'apk','dmg','pkg','mpkg','deb','rpm'
  ];
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

do $$ begin
  create type transfer.transfer_status as enum ('uploading', 'ready', 'expired', 'deleted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type transfer.file_status as enum ('pending', 'uploaded', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists transfer.transfers (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references auth.users (id) on delete cascade,
  message      text check (message is null or char_length(message) <= 2000),
  status       transfer.transfer_status not null default 'uploading',
  expires_at   timestamptz not null,
  total_bytes  bigint not null default 0 check (total_bytes >= 0),
  file_count   integer not null default 0 check (file_count >= 0),
  created_at   timestamptz not null default now(),
  ready_at     timestamptz,
  deleted_at   timestamptz
);

create index if not exists transfers_sender_idx on transfer.transfers (sender_id, created_at desc);
create index if not exists transfers_expiry_idx on transfer.transfers (expires_at) where status in ('uploading', 'ready');

create table if not exists transfer.files (
  id              uuid primary key default gen_random_uuid(),
  transfer_id     uuid not null references transfer.transfers (id) on delete cascade,
  display_name    text not null check (char_length(display_name) between 1 and 255),
  relative_path   text check (relative_path is null or char_length(relative_path) <= 1024),
  size_bytes      bigint not null check (size_bytes > 0 and size_bytes <= 262144000),
  declared_type   text check (declared_type is null or char_length(declared_type) <= 255),
  detected_type   text,
  storage_key     text not null unique,
  status          transfer.file_status not null default 'pending',
  rejected_reason text,
  created_at      timestamptz not null default now(),
  purged_at       timestamptz
);

create index if not exists files_transfer_idx on transfer.files (transfer_id);

create table if not exists transfer.recipients (
  id                  uuid primary key default gen_random_uuid(),
  transfer_id         uuid not null references transfer.transfers (id) on delete cascade,
  email               text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id             uuid references auth.users (id) on delete set null,
  revoked_at          timestamptz,
  first_downloaded_at timestamptz,
  last_downloaded_at  timestamptz,
  created_at          timestamptz not null default now(),
  unique (transfer_id, email)
);

create index if not exists recipients_user_idx on transfer.recipients (user_id) where user_id is not null;
create index if not exists recipients_email_idx on transfer.recipients (email) where user_id is null;

create table if not exists transfer.events (
  id          bigint generated always as identity primary key,
  transfer_id uuid not null references transfer.transfers (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,
  kind        text not null check (kind in ('created', 'ready', 'invited', 'downloaded', 'revoked', 'deleted', 'expired')),
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists events_transfer_idx on transfer.events (transfer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Fonctions d'aide aux règles d'accès (security definer : évitent la
-- récursion entre les règles de `transfers` et de `recipients`)
-- ---------------------------------------------------------------------------

create or replace function transfer.is_sender(p_transfer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from transfer.transfers t
    where t.id = p_transfer_id and t.sender_id = (select auth.uid())
  );
$$;

-- Destinataire actif : compte rattaché, accès non retiré, transfert prêt ou
-- expiré (l'historique reste visible ; les fichiers ne le sont plus).
create or replace function transfer.is_active_recipient(p_transfer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from transfer.recipients r
    join transfer.transfers t on t.id = r.transfer_id
    where r.transfer_id = p_transfer_id
      and r.user_id = (select auth.uid())
      and r.revoked_at is null
      and t.status in ('ready', 'expired')
  );
$$;

-- ---------------------------------------------------------------------------
-- Règles d'accès (RLS) : lecture seule pour le navigateur
-- ---------------------------------------------------------------------------

alter table transfer.transfers  enable row level security;
alter table transfer.files      enable row level security;
alter table transfer.recipients enable row level security;
alter table transfer.events     enable row level security;

drop policy if exists transfers_select on transfer.transfers;
create policy transfers_select on transfer.transfers
  for select to authenticated
  using (
    sender_id = (select auth.uid())
    or (status <> 'deleted' and transfer.is_active_recipient(id))
  );

drop policy if exists files_select on transfer.files;
create policy files_select on transfer.files
  for select to authenticated
  using (
    transfer.is_sender(transfer_id)
    or (status = 'uploaded' and transfer.is_active_recipient(transfer_id))
  );

-- L'expéditeur voit tous les destinataires ; un destinataire ne voit que sa ligne.
drop policy if exists recipients_select on transfer.recipients;
create policy recipients_select on transfer.recipients
  for select to authenticated
  using (
    transfer.is_sender(transfer_id)
    or (user_id = (select auth.uid()) and transfer.is_active_recipient(transfer_id))
  );

-- Le journal n'est visible que par l'expéditeur.
drop policy if exists events_select on transfer.events;
create policy events_select on transfer.events
  for select to authenticated
  using (transfer.is_sender(transfer_id));

-- Aucun droit d'écriture direct. Lecture limitée aux colonnes sans risque.
revoke all on all tables in schema transfer from public, anon, authenticated;
grant select on transfer.transfers to authenticated;
grant select (id, transfer_id, display_name, relative_path, size_bytes, detected_type, status, created_at)
  on transfer.files to authenticated;
grant select (id, transfer_id, email, revoked_at, first_downloaded_at, last_downloaded_at, created_at)
  on transfer.recipients to authenticated;
grant select on transfer.events to authenticated;
grant all on all tables in schema transfer to service_role;
grant usage on all sequences in schema transfer to service_role;

-- ---------------------------------------------------------------------------
-- Utilitaires
-- ---------------------------------------------------------------------------

-- Nom de fichier affichable : sans caractères de contrôle, sans inversion de
-- sens d'écriture (qui permet de déguiser « fdp.exe » en « exe.pdf »), sans
-- séparateur de chemin.
create or replace function transfer.sanitize_filename(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    left(
      btrim(
        regexp_replace(
          regexp_replace(coalesce(p_name, ''), '[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]', '', 'g'),
          '[/\\]', '_', 'g'
        )
      ),
      255
    ),
    ''
  );
$$;

create or replace function transfer.file_extension(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '\.[^.]+$' then lower(substring(p_name from '\.([^.]+)$'))
    else ''
  end;
$$;

-- Octets actuellement stockés pour un utilisateur (transferts non expirés).
create or replace function transfer.active_bytes(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(t.total_bytes), 0)::bigint
  from transfer.transfers t
  where t.sender_id = p_user_id
    and t.status in ('uploading', 'ready')
    and t.expires_at > now();
$$;

-- ---------------------------------------------------------------------------
-- Fonctions appelées par le navigateur (utilisateur connecté)
-- ---------------------------------------------------------------------------

-- Stockage utilisé, pour la jauge.
create or replace function transfer.my_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'active_bytes', transfer.active_bytes(v_uid),
    'limits', transfer.limits()
  );
end;
$$;

-- Rattache au compte connecté les invitations reçues à son adresse e-mail,
-- seulement si cette adresse est vérifiée. Appelée à chaque connexion.
create or replace function transfer.claim_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;

  if v_email is null then
    return 0;
  end if;

  update transfer.recipients r
     set user_id = v_uid
   where r.email = v_email
     and r.user_id is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Crée un transfert (statut « uploading ») et renvoie les clés de stockage
-- que la fonction d'envoi utilisera pour signer les URL d'envoi.
-- Appelée par la fonction serveur `transfer-create` avec le jeton de
-- l'utilisateur : auth.uid() est donc l'expéditeur réel.
--
-- p_files : [{ "name": text, "size": bigint, "type": text?, "path": text? }]
create or replace function transfer.create_transfer(
  p_recipients  text[],
  p_files       jsonb,
  p_expiry_days integer default 7,
  p_message     text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_limits      jsonb := transfer.limits();
  v_sender_mail text;
  v_transfer_id uuid := gen_random_uuid();
  v_total       bigint := 0;
  v_count       integer;
  v_file        jsonb;
  v_name        text;
  v_path        text;
  v_size        bigint;
  v_file_id     uuid;
  v_emails      text[];
  v_email       text;
  v_out_files   jsonb := '[]'::jsonb;
  v_message     text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Seuls les comptes à l'adresse vérifiée peuvent envoyer.
  select lower(u.email) into v_sender_mail
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;
  if v_sender_mail is null then
    raise exception 'email_not_verified' using errcode = '42501';
  end if;

  if p_expiry_days is null or not (v_limits -> 'expiry_days') @> to_jsonb(p_expiry_days) then
    raise exception 'invalid_expiry' using errcode = '22023';
  end if;

  if v_message is not null and char_length(v_message) > (v_limits ->> 'max_message_chars')::int then
    raise exception 'message_too_long' using errcode = '22023';
  end if;

  -- Limite d'envois sur 24 heures.
  select count(*) into v_count
  from transfer.transfers t
  where t.sender_id = v_uid and t.created_at > now() - interval '24 hours';
  if v_count >= (v_limits ->> 'max_transfers_per_day')::int then
    raise exception 'daily_limit_reached' using errcode = '54000';
  end if;

  -- Destinataires : normalisés, dédoublonnés, valides.
  select coalesce(array_agg(distinct e), '{}') into v_emails
  from (
    select lower(btrim(x)) as e
    from unnest(coalesce(p_recipients, '{}')) as x
    where btrim(x) <> ''
  ) s;

  if cardinality(v_emails) = 0 then
    raise exception 'no_recipients' using errcode = '22023';
  end if;
  if cardinality(v_emails) > (v_limits ->> 'max_recipients')::int then
    raise exception 'too_many_recipients' using errcode = '22023';
  end if;
  foreach v_email in array v_emails loop
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then
      raise exception 'invalid_recipient' using errcode = '22023';
    end if;
  end loop;

  -- Fichiers.
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'no_files' using errcode = '22023';
  end if;
  if jsonb_array_length(p_files) > (v_limits ->> 'max_files')::int then
    raise exception 'too_many_files' using errcode = '22023';
  end if;

  for v_file in select value from jsonb_array_elements(p_files) loop
    v_size := (v_file ->> 'size')::bigint;
    if v_size is null or v_size <= 0 then
      raise exception 'invalid_file_size' using errcode = '22023';
    end if;
    if v_size > (v_limits ->> 'max_file_bytes')::bigint then
      raise exception 'file_too_large' using errcode = '22023';
    end if;
    v_name := transfer.sanitize_filename(v_file ->> 'name');
    if v_name is null then
      raise exception 'invalid_file_name' using errcode = '22023';
    end if;
    if transfer.file_extension(v_name) = any (transfer.blocked_extensions()) then
      raise exception 'blocked_file_type' using errcode = '22023';
    end if;
    v_total := v_total + v_size;
  end loop;

  if v_total > (v_limits ->> 'max_transfer_bytes')::bigint then
    raise exception 'transfer_too_large' using errcode = '22023';
  end if;
  if transfer.active_bytes(v_uid) + v_total > (v_limits ->> 'max_active_bytes')::bigint then
    raise exception 'storage_quota_exceeded' using errcode = '53100';
  end if;

  insert into transfer.transfers (id, sender_id, message, status, expires_at, total_bytes, file_count)
  values (
    v_transfer_id, v_uid, v_message, 'uploading',
    now() + make_interval(days => p_expiry_days),
    v_total, jsonb_array_length(p_files)
  );

  for v_file in select value from jsonb_array_elements(p_files) loop
    v_file_id := gen_random_uuid();
    v_name := transfer.sanitize_filename(v_file ->> 'name');
    v_path := nullif(left(
      regexp_replace(coalesce(v_file ->> 'path', ''), '[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]', '', 'g'),
      1024), '');
    insert into transfer.files (id, transfer_id, display_name, relative_path, size_bytes, declared_type, storage_key)
    values (
      v_file_id, v_transfer_id, v_name, v_path, (v_file ->> 'size')::bigint,
      left(v_file ->> 'type', 255),
      -- Clé de stockage aléatoire : jamais le nom du fichier.
      v_uid::text || '/' || v_transfer_id::text || '/' || v_file_id::text
    );
    v_out_files := v_out_files || jsonb_build_object(
      'id', v_file_id,
      'name', v_name,
      'size', (v_file ->> 'size')::bigint,
      'storage_key', v_uid::text || '/' || v_transfer_id::text || '/' || v_file_id::text
    );
  end loop;

  -- Un destinataire qui a déjà un compte à l'adresse vérifiée y est rattaché
  -- tout de suite. La colonne user_id n'est pas lisible par l'expéditeur :
  -- il ne peut pas savoir qui possède un compte.
  insert into transfer.recipients (transfer_id, email, user_id)
  select v_transfer_id, e,
         (select u.id from auth.users u
           where lower(u.email) = e and u.email_confirmed_at is not null
           limit 1)
    from unnest(v_emails) as e;

  insert into transfer.events (transfer_id, actor_id, kind, detail)
  values (v_transfer_id, v_uid, 'created', jsonb_build_object('files', jsonb_array_length(p_files), 'bytes', v_total));

  return jsonb_build_object(
    'transfer_id', v_transfer_id,
    'expires_at', now() + make_interval(days => p_expiry_days),
    'files', v_out_files
  );
end;
$$;

-- Retire l'accès d'un destinataire (expéditeur uniquement). Définitif.
create or replace function transfer.revoke_recipient(p_recipient_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_transfer_id uuid;
  v_email text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  update transfer.recipients r
     set revoked_at = now()
    from transfer.transfers t
   where r.id = p_recipient_id
     and t.id = r.transfer_id
     and t.sender_id = v_uid
     and r.revoked_at is null
  returning r.transfer_id, r.email into v_transfer_id, v_email;

  if v_transfer_id is null then
    -- Même réponse que le destinataire n'existe pas ou n'appartienne pas
    -- à l'utilisateur : rien n'est révélé.
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into transfer.events (transfer_id, actor_id, kind, detail)
  values (v_transfer_id, v_uid, 'revoked', jsonb_build_object('email', v_email));
end;
$$;

-- Supprime un transfert (expéditeur uniquement). Les fichiers deviennent
-- inaccessibles immédiatement ; la tâche de nettoyage les efface du stockage.
create or replace function transfer.delete_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_found uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  update transfer.transfers t
     set status = 'deleted', deleted_at = now()
   where t.id = p_transfer_id
     and t.sender_id = v_uid
     and t.status <> 'deleted'
  returning t.id into v_found;

  if v_found is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into transfer.events (transfer_id, actor_id, kind)
  values (p_transfer_id, v_uid, 'deleted');
end;
$$;

-- Autorise le téléchargement d'un fichier et renvoie sa clé de stockage.
-- Appelée par la fonction serveur `transfer-download` avec le jeton de
-- l'utilisateur ; c'est elle qui signe ensuite une URL de courte durée.
create or replace function transfer.authorize_download(p_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_is_sender boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select f.id, f.display_name, f.storage_key, f.size_bytes, f.status as file_status,
         t.id as transfer_id, t.sender_id, t.status as transfer_status, t.expires_at
    into v_row
    from transfer.files f
    join transfer.transfers t on t.id = f.transfer_id
   where f.id = p_file_id;

  if v_row.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_is_sender := v_row.sender_id = v_uid;

  if not v_is_sender and not exists (
    select 1 from transfer.recipients r
    where r.transfer_id = v_row.transfer_id
      and r.user_id = v_uid
      and r.revoked_at is null
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_row.transfer_status <> 'ready' or v_row.expires_at <= now() or v_row.file_status <> 'uploaded' then
    raise exception 'not_available' using errcode = 'P0002';
  end if;

  if not v_is_sender then
    update transfer.recipients r
       set first_downloaded_at = coalesce(r.first_downloaded_at, now()),
           last_downloaded_at = now()
     where r.transfer_id = v_row.transfer_id and r.user_id = v_uid;

    insert into transfer.events (transfer_id, actor_id, kind, detail)
    values (v_row.transfer_id, v_uid, 'downloaded', jsonb_build_object('file', v_row.display_name));
  end if;

  return jsonb_build_object(
    'storage_key', v_row.storage_key,
    'name', v_row.display_name,
    'size', v_row.size_bytes
  );
end;
$$;

-- Liste des transferts reçus, avec le nom de l'expéditeur.
create or replace function transfer.inbox(p_limit integer default 50, p_before timestamptz default null)
returns table (
  id uuid,
  sender_name text,
  sender_email text,
  message text,
  status transfer.transfer_status,
  expires_at timestamptz,
  total_bytes bigint,
  file_count integer,
  created_at timestamptz,
  first_downloaded_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id,
         nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
         u.email,
         t.message,
         case when t.status = 'ready' and t.expires_at <= now() then 'expired'::transfer.transfer_status else t.status end,
         t.expires_at, t.total_bytes, t.file_count, t.created_at,
         r.first_downloaded_at
    from transfer.recipients r
    join transfer.transfers t on t.id = r.transfer_id
    join auth.users u on u.id = t.sender_id
    left join public.profiles p on p.id = t.sender_id
   where r.user_id = (select auth.uid())
     and r.revoked_at is null
     and t.status in ('ready', 'expired')
     and (p_before is null or t.created_at < p_before)
   order by t.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- Liste des transferts envoyés, avec l'état de téléchargement.
create or replace function transfer.outbox(p_limit integer default 50, p_before timestamptz default null)
returns table (
  id uuid,
  recipient_emails text[],
  recipient_count integer,
  downloaded_count integer,
  message text,
  status transfer.transfer_status,
  expires_at timestamptz,
  total_bytes bigint,
  file_count integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id,
         array(select r.email from transfer.recipients r where r.transfer_id = t.id order by r.created_at, r.email),
         (select count(*) from transfer.recipients r where r.transfer_id = t.id and r.revoked_at is null)::int,
         (select count(*) from transfer.recipients r where r.transfer_id = t.id and r.revoked_at is null and r.first_downloaded_at is not null)::int,
         t.message,
         case when t.status = 'ready' and t.expires_at <= now() then 'expired'::transfer.transfer_status else t.status end,
         t.expires_at, t.total_bytes, t.file_count, t.created_at
    from transfer.transfers t
   where t.sender_id = (select auth.uid())
     and t.status <> 'deleted'
     and (p_before is null or t.created_at < p_before)
   order by t.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- ---------------------------------------------------------------------------
-- Fonctions réservées au serveur (service_role)
-- ---------------------------------------------------------------------------

-- Résultat de la vérification d'un fichier après son dépôt dans le stockage.
create or replace function transfer.record_file_check(
  p_file_id       uuid,
  p_actual_size   bigint,
  p_detected_type text,
  p_rejected_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update transfer.files f
     set status = case when p_rejected_reason is null and p_actual_size = f.size_bytes
                       then 'uploaded'::transfer.file_status
                       else 'rejected'::transfer.file_status end,
         detected_type = p_detected_type,
         rejected_reason = case
           when p_rejected_reason is not null then p_rejected_reason
           when p_actual_size is distinct from f.size_bytes then 'size_mismatch'
           else null end
   where f.id = p_file_id and f.status = 'pending';
end;
$$;

-- Passe un transfert à « prêt » quand tous ses fichiers ont été vérifiés.
-- Renvoie les adresses à prévenir par e-mail.
create or replace function transfer.finalize_transfer(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t record;
  v_pending integer;
  v_ok integer;
  v_bytes bigint;
  v_emails text[];
begin
  select * into v_t from transfer.transfers where id = p_transfer_id for update;
  if v_t.id is null or v_t.status <> 'uploading' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'uploaded'),
         coalesce(sum(size_bytes) filter (where status = 'uploaded'), 0)
    into v_pending, v_ok, v_bytes
    from transfer.files where transfer_id = p_transfer_id;

  if v_pending > 0 then
    raise exception 'files_pending' using errcode = '55000';
  end if;
  if v_ok = 0 then
    update transfer.transfers set status = 'deleted', deleted_at = now() where id = p_transfer_id;
    raise exception 'no_valid_files' using errcode = '22023';
  end if;

  update transfer.transfers
     set status = 'ready', ready_at = now(), total_bytes = v_bytes, file_count = v_ok
   where id = p_transfer_id;

  select array_agg(email order by email) into v_emails
    from transfer.recipients where transfer_id = p_transfer_id and revoked_at is null;

  insert into transfer.events (transfer_id, actor_id, kind, detail)
  values (p_transfer_id, v_t.sender_id, 'ready', jsonb_build_object('files', v_ok, 'bytes', v_bytes)),
         (p_transfer_id, null, 'invited', jsonb_build_object('emails', to_jsonb(v_emails)));

  return jsonb_build_object('sender_id', v_t.sender_id, 'recipients', to_jsonb(v_emails), 'expires_at', v_t.expires_at);
end;
$$;

-- Marque les transferts expirés et abandonne les envois jamais terminés.
create or replace function transfer.expire_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update transfer.transfers
       set status = 'expired'
     where status = 'ready' and expires_at <= now()
    returning id
  )
  insert into transfer.events (transfer_id, kind)
  select id, 'expired' from expired;
  get diagnostics v_count = row_count;

  update transfer.transfers
     set status = 'deleted', deleted_at = now()
   where status = 'uploading' and created_at < now() - interval '24 hours';

  return v_count;
end;
$$;

-- Fichiers à effacer du stockage (transferts expirés, supprimés, fichiers refusés).
create or replace function transfer.purge_candidates(p_limit integer default 500)
returns table (file_id uuid, storage_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.storage_key
    from transfer.files f
    join transfer.transfers t on t.id = f.transfer_id
   where f.purged_at is null
     and (t.status in ('expired', 'deleted') or f.status = 'rejected')
   order by f.created_at
   limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;

create or replace function transfer.mark_purged(p_file_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update transfer.files set purged_at = now() where id = any (p_file_ids) and purged_at is null;
$$;

-- État d'un transfert et de ses fichiers, pour la validation après dépôt.
create or replace function transfer.files_for_check(p_transfer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'sender_id', t.sender_id,
    'status', t.status,
    'message', t.message,
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'storage_key', f.storage_key, 'size', f.size_bytes,
        'name', f.display_name, 'status', f.status, 'rejected_reason', f.rejected_reason
      ) order by f.created_at, f.id)
      from transfer.files f where f.transfer_id = t.id
    ), '[]'::jsonb)
  )
  from transfer.transfers t
  where t.id = p_transfer_id;
$$;

-- Nom et adresse de l'expéditeur, pour l'e-mail d'invitation.
create or replace function transfer.sender_info(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'email', u.email,
    'name', nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
  )
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------

revoke all on all functions in schema transfer from public, anon, authenticated;

grant execute on function
  transfer.limits(),
  transfer.my_usage(),
  transfer.claim_invitations(),
  transfer.create_transfer(text[], jsonb, integer, text),
  transfer.revoke_recipient(uuid),
  transfer.delete_transfer(uuid),
  transfer.authorize_download(uuid),
  transfer.inbox(integer, timestamptz),
  transfer.outbox(integer, timestamptz),
  -- utilisées par les règles RLS
  transfer.is_sender(uuid),
  transfer.is_active_recipient(uuid)
to authenticated;

grant execute on all functions in schema transfer to service_role;

-- ---------------------------------------------------------------------------
-- Expiration automatique (si pg_cron est activé)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('transfer-expire', '*/15 * * * *', 'select transfer.expire_due()');
  end if;
end $$;
