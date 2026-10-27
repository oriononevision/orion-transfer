-- Tests des règles d'accès de ORION TRANSFER.
-- À lancer sur une base locale vierge : supabase_stub.sql, puis la migration,
-- puis ce fichier (voir scripts/test-db.sh). Toute assertion fausse arrête
-- le script avec une erreur.

\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.ok(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'ÉCHEC : %', p_msg;
  end if;
  raise notice 'ok — %', p_msg;
end $$;

-- Exécute p_sql et vérifie qu'il échoue avec un message contenant p_expected.
create or replace function tests.fails(p_sql text, p_expected text, p_msg text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_expected in sqlerrm) > 0 then
      raise notice 'ok — % (refusé : %)', p_msg, sqlerrm;
      return;
    end if;
    raise exception 'ÉCHEC : % — erreur inattendue : %', p_msg, sqlerrm;
  end;
  raise exception 'ÉCHEC : % — aurait dû être refusé', p_msg;
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Comptes de test
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@orion.dev',   now()),
  ('22222222-2222-2222-2222-222222222222', 'bob@orion.dev',     now()),
  ('33333333-3333-3333-3333-333333333333', 'carol@studio.fr',   now()),
  ('44444444-4444-4444-4444-444444444444', 'mallory@evil.test', now()),
  ('55555555-5555-5555-5555-555555555555', 'dave@orion.dev',    null),
  ('66666666-6666-6666-6666-666666666666', 'invite@client.fr',  null);
insert into public.profiles (id, email, first_name, last_name) values
  ('11111111-1111-1111-1111-111111111111', 'alice@orion.dev', 'Alice', 'Martin');

-- ===========================================================================
-- 1. Création d'un transfert par Alice
-- ===========================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select set_config('tests.created', transfer.create_transfer(
  array['Bob@orion.dev', 'carol@studio.fr', ' bob@orion.dev ', 'invite@client.fr', 'nouveau@client.fr'],
  '[{"name":"build.zip","size":1000,"type":"application/zip"},
    {"name":"notes‮exe.md","size":200,"path":"docs/notes.md"}]'::jsonb,
  7, 'Livraison du build')::text, false);

select set_config('tests.tid', (current_setting('tests.created')::jsonb ->> 'transfer_id'), false);

select tests.ok(jsonb_array_length(current_setting('tests.created')::jsonb -> 'files') = 2,
  'Alice crée un transfert de 2 fichiers');
select tests.ok(
  (select count(*) from transfer.recipients where transfer_id = current_setting('tests.tid')::uuid) = 4,
  'les destinataires sont normalisés et dédoublonnés (4 adresses)');
select tests.ok(
  (select display_name from transfer.files where transfer_id = current_setting('tests.tid')::uuid and size_bytes = 200) = 'notesexe.md',
  'le caractère d''inversion de sens est retiré du nom de fichier');
select tests.ok(
  (current_setting('tests.created')::jsonb -> 'files' -> 0 ->> 'storage_key') like '11111111-1111-1111-1111-111111111111/%',
  'la clé de stockage est aléatoire et rangée sous l''expéditeur');

-- Limites
select tests.fails($q$select transfer.create_transfer(array['bob@orion.dev'], '[{"name":"setup.exe","size":10}]', 7)$q$,
  'blocked_file_type', 'un .exe est refusé');
select tests.fails($q$select transfer.create_transfer(array['bob@orion.dev'], '[{"name":"SETUP.MSI","size":10}]', 7)$q$,
  'blocked_file_type', 'l''extension est vérifiée sans tenir compte des majuscules');
select tests.fails($q$select transfer.create_transfer(array['bob@orion.dev'], '[{"name":"video.mov","size":262144001}]', 7)$q$,
  'file_too_large', 'un fichier de plus de 250 Mo est refusé');
select tests.fails($q$select transfer.create_transfer(array['bob@orion.dev'], '[{"name":"a","size":262144000},{"name":"b","size":262144000},{"name":"c","size":262144000},{"name":"d","size":262144000},{"name":"e","size":25165825}]', 7)$q$,
  'transfer_too_large', 'un transfert de plus de 1 Go est refusé');
select tests.fails($q$select transfer.create_transfer(array['bob@orion.dev'], (select jsonb_agg(jsonb_build_object('name','f'||g,'size',1)) from generate_series(1,21) g), 7)$q$,
  'too_many_files', 'plus de 20 fichiers sont refusés');
select tests.fails($q$select transfer.create_transfer(array['bob@orion.dev'], '[{"name":"a.txt","size":1}]', 3)$q$,
  'invalid_expiry', 'une durée hors 1, 7 ou 14 jours est refusée');
select tests.fails($q$select transfer.create_transfer(array['pas-une-adresse'], '[{"name":"a.txt","size":1}]', 7)$q$,
  'invalid_recipient', 'une adresse invalide est refusée');
select tests.fails($q$select transfer.create_transfer(array[]::text[], '[{"name":"a.txt","size":1}]', 7)$q$,
  'no_recipients', 'un envoi sans destinataire est refusé');

-- Aucune écriture directe
select tests.fails($q$insert into transfer.transfers (sender_id, expires_at) values ('11111111-1111-1111-1111-111111111111', now())$q$,
  'permission denied', 'insertion directe interdite');
select tests.fails($q$update transfer.transfers set expires_at = now() + interval '1 year'$q$,
  'permission denied', 'modification directe interdite (prolonger l''expiration)');
select tests.fails($q$delete from transfer.transfers$q$,
  'permission denied', 'suppression directe interdite');
select tests.fails($q$select storage_key from transfer.files$q$,
  'permission denied', 'la clé de stockage n''est pas lisible depuis le navigateur');
select tests.fails($q$select user_id from transfer.recipients$q$,
  'permission denied', 'le compte d''un destinataire n''est pas lisible (pas d''énumération)');
select tests.fails($q$select transfer.finalize_transfer(current_setting('tests.tid')::uuid)$q$,
  'permission denied', 'un utilisateur ne peut pas valider lui-même ses fichiers');

-- ===========================================================================
-- 2. Compte non vérifié
-- ===========================================================================
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select tests.fails($q$select transfer.create_transfer(array['bob@orion.dev'], '[{"name":"a.txt","size":1}]', 7)$q$,
  'email_not_verified', 'un compte à l''adresse non vérifiée ne peut pas envoyer');

-- ===========================================================================
-- 3. Avant validation des fichiers, les destinataires ne voient rien
-- ===========================================================================
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select tests.ok(transfer.claim_invitations() = 0, 'Bob, qui avait déjà un compte, est rattaché dès l''envoi');
select tests.ok((select count(*) from transfer.transfers) = 0, 'Bob ne voit pas un transfert encore en cours d''envoi');
select tests.ok((select count(*) from transfer.inbox()) = 0, 'boîte de réception de Bob vide pendant l''envoi');

-- ===========================================================================
-- 4. Le serveur vérifie les fichiers et valide le transfert
-- ===========================================================================
reset role;
set role service_role;
select transfer.record_file_check(f.id, f.size_bytes, 'zip') from transfer.files f
 where f.transfer_id = current_setting('tests.tid')::uuid and f.size_bytes = 1000;
select transfer.record_file_check(f.id, f.size_bytes, 'text') from transfer.files f
 where f.transfer_id = current_setting('tests.tid')::uuid and f.size_bytes = 200;
select tests.ok((transfer.finalize_transfer(current_setting('tests.tid')::uuid) -> 'recipients') = '["bob@orion.dev", "carol@studio.fr", "invite@client.fr", "nouveau@client.fr"]'::jsonb,
  'le transfert est prêt et renvoie les adresses à prévenir');

-- ===========================================================================
-- 5. Bob, destinataire vérifié
-- ===========================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select tests.ok((select count(*) from transfer.transfers) = 1, 'Bob voit le transfert');
select tests.ok((select sender_name from transfer.inbox() limit 1) = 'Alice Martin', 'Bob voit le nom de l''expéditrice');
select tests.ok((select count(*) from transfer.files) = 2, 'Bob voit les 2 fichiers');
select tests.ok((select count(*) from transfer.recipients) = 1, 'Bob ne voit que sa propre ligne de destinataire');
select tests.ok((select count(*) from transfer.events) = 0, 'Bob ne voit pas le journal de l''expéditrice');
select tests.ok((transfer.authorize_download((select id from transfer.files where size_bytes = 1000)) ->> 'storage_key') like '11111111-%',
  'Bob est autorisé à télécharger');
select tests.fails($q$select transfer.revoke_recipient((select id from transfer.recipients limit 1))$q$,
  'not_found', 'Bob ne peut pas retirer un accès');
select tests.fails($q$select transfer.delete_transfer(current_setting('tests.tid')::uuid)$q$,
  'not_found', 'Bob ne peut pas supprimer le transfert');

-- ===========================================================================
-- 6. Mallory, utilisatrice vérifiée mais non destinataire
-- ===========================================================================
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select transfer.claim_invitations();
select tests.ok((select count(*) from transfer.transfers) = 0, 'Mallory ne voit aucun transfert');
select tests.ok((select count(*) from transfer.files) = 0, 'Mallory ne voit aucun fichier');
select tests.ok((select count(*) from transfer.recipients) = 0, 'Mallory ne voit aucun destinataire');
select tests.ok((select count(*) from transfer.inbox()) = 0, 'boîte de réception de Mallory vide');
select tests.ok((select count(*) from transfer.outbox()) = 0, 'boîte d''envoi de Mallory vide');
select set_config('tests.fid', (select f.id::text from transfer.files f limit 1), false);
reset role;
select set_config('tests.fid', (select id::text from transfer.files where size_bytes = 1000), false);
set role authenticated;
select tests.fails($q$select transfer.authorize_download(current_setting('tests.fid')::uuid)$q$,
  'not_found', 'Mallory ne peut pas télécharger même en connaissant l''identifiant du fichier');
select tests.fails($q$select transfer.delete_transfer(current_setting('tests.tid')::uuid)$q$,
  'not_found', 'Mallory ne peut pas supprimer le transfert');

-- ===========================================================================
-- 7. Compte non vérifié créé avec l'adresse d'un invité
-- ===========================================================================
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
select tests.ok(transfer.claim_invitations() = 0, 'une adresse non vérifiée ne récupère pas l''invitation');
select tests.ok((select count(*) from transfer.transfers) = 0, 'et ne voit donc rien');

-- Un invité sans compte s'inscrit après l'envoi et vérifie son adresse
reset role;
insert into auth.users (id, email, email_confirmed_at)
values ('77777777-7777-7777-7777-777777777777', 'Nouveau@Client.fr', now());
set role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
select tests.ok((select count(*) from transfer.inbox()) = 0, 'avant rattachement, le nouvel inscrit ne voit rien');
select tests.ok(transfer.claim_invitations() = 1, 'à sa connexion, son invitation est rattachée à son compte');
select tests.ok((select count(*) from transfer.inbox()) = 1, 'il voit alors le transfert');

-- ===========================================================================
-- 8. Alice, expéditrice
-- ===========================================================================
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select tests.ok((select downloaded_count from transfer.outbox() limit 1) = 1, 'Alice voit 1 téléchargement');
select tests.ok((select count(*) from transfer.recipients) = 4, 'Alice voit ses 4 destinataires');
select tests.ok((select count(*) from transfer.events where kind = 'downloaded') = 1, 'le téléchargement est journalisé');
select (transfer.my_usage() ->> 'active_bytes')::bigint = 1200 as usage_ok \gset
select tests.ok(:'usage_ok'::boolean, 'le stockage utilisé est de 1 200 octets');

-- Retrait de l'accès de Bob
select transfer.revoke_recipient((select id from transfer.recipients where email = 'bob@orion.dev'));
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select tests.ok((select count(*) from transfer.transfers) = 0, 'après retrait, Bob ne voit plus le transfert');
select tests.ok((select count(*) from transfer.inbox()) = 0, 'après retrait, la boîte de Bob est vide');
select tests.fails($q$select transfer.authorize_download(current_setting('tests.fid')::uuid)$q$,
  'not_found', 'après retrait, Bob ne peut plus télécharger');

-- ===========================================================================
-- 9. Expiration
-- ===========================================================================
reset role;
update transfer.transfers set expires_at = now() - interval '1 minute' where id = current_setting('tests.tid')::uuid;
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select transfer.claim_invitations();
select tests.ok((select status::text from transfer.inbox() limit 1) = 'expired', 'Carol voit le transfert comme expiré');
select tests.fails($q$select transfer.authorize_download(current_setting('tests.fid')::uuid)$q$,
  'not_available', 'un fichier expiré ne peut plus être téléchargé');
reset role;
set role service_role;
select tests.ok(transfer.expire_due() = 1, 'la tâche planifiée marque le transfert comme expiré');
select tests.ok((select count(*) from transfer.purge_candidates()) = 2, 'ses 2 fichiers sont à effacer du stockage');

-- ===========================================================================
-- 10. Suppression par l'expéditrice
-- ===========================================================================
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select set_config('tests.t2', (transfer.create_transfer(array['carol@studio.fr'], '[{"name":"a.pdf","size":50}]', 1) ->> 'transfer_id'), false);
reset role;
set role service_role;
select transfer.record_file_check(id, 50, 'pdf') from transfer.files where transfer_id = current_setting('tests.t2')::uuid;
select transfer.finalize_transfer(current_setting('tests.t2')::uuid);
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select tests.ok((select count(*) from transfer.inbox() where id = current_setting('tests.t2')::uuid) = 1, 'Carol reçoit le second transfert');
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select transfer.delete_transfer(current_setting('tests.t2')::uuid);
select tests.ok((select count(*) from transfer.outbox() where id = current_setting('tests.t2')::uuid) = 0, 'le transfert supprimé disparaît des envois');
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select tests.ok((select count(*) from transfer.inbox() where id = current_setting('tests.t2')::uuid) = 0, 'et de la boîte de Carol');
select tests.ok((select count(*) from transfer.transfers where id = current_setting('tests.t2')::uuid) = 0, 'Carol ne peut plus le lire directement');

-- ===========================================================================
-- 11. Fichier dont la taille réelle ne correspond pas
-- ===========================================================================
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select set_config('tests.t3', (transfer.create_transfer(array['bob@orion.dev'], '[{"name":"x.bin","size":10}]', 7) ->> 'transfer_id'), false);
reset role;
set role service_role;
select transfer.record_file_check(id, 999999, 'unknown') from transfer.files where transfer_id = current_setting('tests.t3')::uuid;
select tests.ok((select rejected_reason from transfer.files where transfer_id = current_setting('tests.t3')::uuid) = 'size_mismatch',
  'un fichier plus gros que déclaré est refusé');
select tests.fails($q$select transfer.finalize_transfer(current_setting('tests.t3')::uuid)$q$,
  'no_valid_files', 'un transfert sans fichier valide n''est jamais publié');

-- ===========================================================================
-- 12. Quota de stockage et visiteurs non connectés
-- ===========================================================================
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select transfer.create_transfer(array['bob@orion.dev'], '[{"name":"a","size":262144000},{"name":"b","size":262144000},{"name":"c","size":262144000},{"name":"d","size":262144000},{"name":"e","size":25165824}]', 14);
select transfer.create_transfer(array['bob@orion.dev'], '[{"name":"a","size":262144000},{"name":"b","size":262144000},{"name":"c","size":262144000},{"name":"d","size":262144000},{"name":"e","size":25165824}]', 14);
select tests.fails($q$select transfer.create_transfer(array['bob@orion.dev'], '[{"name":"z","size":1000}]', 7)$q$,
  'storage_quota_exceeded', 'au-delà de 2 Go de stockage actif, l''envoi est refusé');

reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select tests.fails($q$select * from transfer.transfers$q$, 'permission denied', 'un visiteur non connecté n''a accès à rien');
select tests.fails($q$select transfer.inbox()$q$, 'permission denied', 'un visiteur non connecté ne peut appeler aucune fonction');

reset role;
\o
\echo
\echo 'Tous les tests de règles d''accès sont passés.'
