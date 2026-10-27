# ORION Transfer

Application web de l'écosystème ORION pour envoyer, recevoir et retrouver des fichiers de travail. Les comptes sont ceux d'ORION (même projet Supabase que ORION Core).

> État : base technique du MVP. L'interface, la base de données et les règles d'accès sont prêtes et testées. **Les fonctions serveur d'envoi et de téléchargement (Cloudflare R2) et les e-mails ne sont pas encore écrits** : sans elles, un envoi échoue avec un message d'erreur.

## Pile

- Vite + React 19 + TypeScript + React Router (comme ORION Core)
- Supabase : comptes (partagés avec Core), base Postgres (schéma `transfer`), règles d'accès RLS
- Cloudflare R2 pour les fichiers (bucket privé, URL signées de courte durée) — à brancher
- Resend pour les e-mails d'invitation — à brancher
- Vitest (règles de fichiers, statuts) et tests SQL sur un Postgres local (règles d'accès)

## Lancer en local

```bash
npm install
cp .env.example .env.local   # renseigner l'URL et la clé « anon » du projet Supabase d'ORION
npm run dev                  # http://localhost:5175
```

Ports de l'écosystème : site 5173, Core 5174, Transfer 5175.

## Mettre en place la base (une seule fois, à faire relire par l'équipe Core)

1. Appliquer `supabase/migrations/20261027000000_transfer_schema.sql` (SQL Editor de Supabase, ou `supabase db push`). Elle ne touche à rien d'existant : tout est dans le schéma `transfer`.
2. **Settings → API → Exposed schemas** : ajouter `transfer`.
3. **Database → Extensions** : activer `pg_cron`, puis rejouer le dernier bloc de la migration pour planifier l'expiration automatique.
4. **Authentication → URL Configuration** : ajouter `http://localhost:5175/auth/callback` (et l'adresse de production) aux URL de redirection autorisées, pour les liens de connexion par e-mail.

## Tests

```bash
npm test          # règles de fichiers, statuts, textes (Vitest)
npm run test:db   # migration + règles d'accès sur un PostgreSQL local jetable
```

`test:db` a besoin de PostgreSQL 15+ en local (`PGHOST`, `PGPORT`, `PGUSER`). Il crée une base `transfer_test`, imite le strict nécessaire de Supabase (`supabase/tests/supabase_stub.sql`), applique la migration deux fois (elle doit pouvoir être rejouée) et vérifie notamment :

- un utilisateur ne voit jamais les transferts, fichiers ou destinataires d'un autre, même en connaissant leurs identifiants ;
- un destinataire ne voit rien tant que les fichiers ne sont pas vérifiés, et plus rien après un retrait d'accès ou une suppression ;
- une adresse non vérifiée ne peut ni envoyer ni récupérer une invitation ;
- le navigateur ne peut rien écrire directement, ni lire les clés de stockage ou savoir qui possède un compte ;
- limites : 250 Mo par fichier, 1 Go et 20 fichiers par envoi, 2 Go de stockage actif, 20 envois par jour, programmes refusés.

## Sécurité : où les règles s'appliquent

| Règle | Navigateur (confort) | Serveur (garantie) |
|---|---|---|
| Taille, nombre, formats | `src/lib/fileRules.ts` | `transfer.create_transfer()` + vérification du contenu réel après dépôt |
| Qui voit quoi | — | règles RLS + fonctions `security definer` |
| Expiration | affichage | `authorize_download()` vérifie la date ; `expire_due()` (pg_cron) ; nettoyage du stockage |
| Secrets (`.env`, clés) | avertissement avant envoi, analyse locale uniquement | — |

Ce qui n'existe pas encore et ne doit pas être annoncé : chiffrement de bout en bout, analyse antivirus, aperçu des fichiers, lien de partage public.

## Structure

```
src/
  api/transfers.ts      accès aux données et fonctions serveur
  components/           en-tête, panneau d'envoi, pastilles de statut
  pages/                transferts, détail, connexion, compte
  lib/fileRules.ts      limites, formats, dossiers exclus, secrets, programmes déguisés
  lib/readDrop.ts       lecture des fichiers et dossiers déposés
  i18n/fr.ts            tous les textes (français pour la bêta)
supabase/
  migrations/           schéma `transfer`, règles d'accès, fonctions
  tests/                tests SQL des règles d'accès
```
