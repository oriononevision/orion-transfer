# ORION Transfer

Application web de l'écosystème ORION pour envoyer, recevoir et retrouver des fichiers de travail. Les comptes sont ceux d'ORION (même projet Supabase que ORION Core).

> État : MVP complet, testé, pas encore mis en ligne. Interface, base de données, règles d'accès, fonctions serveur (dépôt et téléchargement via Supabase Storage, e-mails via Resend, nettoyage) et mode démonstration. **Pour la mise en ligne, suivre [DEPLOIEMENT.md](DEPLOIEMENT.md).**

## Pile

- Vite + React 19 + TypeScript + React Router (comme ORION Core)
- Supabase : comptes (partagés avec Core), base Postgres (schéma `transfer`), règles d'accès RLS
- Supabase Edge Functions (Deno) : `transfer-create`, `transfer-complete`, `transfer-download`, `transfer-cleanup`
- Supabase Storage pour les fichiers (bucket privé `orion-transfer`, liens signés de courte durée, dépôt direct depuis le navigateur). Le client Cloudflare R2 (`storageR2.ts`) reste dans le code mais n'est plus branché.
- Resend pour les e-mails d'invitation
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
npm test                     # règles de fichiers, statuts, textes (Vitest)
npm run test:db              # migration + règles d'accès sur un PostgreSQL local jetable
./scripts/test-functions.sh  # fonctions serveur de bout en bout (Deno + PostgreSQL local)
```

Les trois tournent aussi automatiquement sur GitHub à chaque envoi de code (`.github/workflows/ci.yml`).

## Mode démonstration

```bash
VITE_DEMO=1 npm run dev
```

Même application, données fictives en mémoire, aucun serveur ; un bandeau le signale.

`test:db` a besoin de PostgreSQL 15+ en local (`PGHOST`, `PGPORT`, `PGUSER`). Il crée une base `transfer_test`, imite le strict nécessaire de Supabase (`supabase/tests/supabase_stub.sql`), applique la migration deux fois (elle doit pouvoir être rejouée) et vérifie notamment :

- un utilisateur ne voit jamais les transferts, fichiers ou destinataires d'un autre, même en connaissant leurs identifiants ;
- un destinataire ne voit rien tant que les fichiers ne sont pas vérifiés, et plus rien après un retrait d'accès ou une suppression ;
- une adresse non vérifiée ne peut ni envoyer ni récupérer une invitation ;
- le navigateur ne peut rien écrire directement, ni lire les clés de stockage ou savoir qui possède un compte ;
- limites : 50 Mo par fichier (maximum de l'offre gratuite Supabase), 500 Mo et 20 fichiers par envoi, 500 Mo de stockage actif, 20 envois par jour, programmes refusés.

## Sécurité : où les règles s'appliquent

| Règle | Navigateur (confort) | Serveur (garantie) |
|---|---|---|
| Taille, nombre, formats | `src/lib/fileRules.ts` | `transfer.create_transfer()` + vérification du contenu réel après dépôt |
| Qui voit quoi | — | règles RLS + fonctions `security definer` |
| Expiration | affichage | `authorize_download()` vérifie la date ; `expire_due()` (pg_cron) ; nettoyage du stockage |
| Secrets (`.env`, clés) | avertissement avant envoi, analyse locale uniquement | — |

Ce qui n'existe pas encore et ne doit pas être annoncé : chiffrement de bout en bout, analyse antivirus, aperçu des fichiers, lien de partage public, reprise d'un envoi interrompu.

Limite connue : la taille d'un fichier est vérifiée **après** son dépôt (et le fichier refusé s'il dépasse ce qui était déclaré). Une URL de dépôt reste valable 15 minutes.

## Structure

```
src/
  api/transfers.ts      accès aux données et fonctions serveur
  components/           en-tête, panneau d'envoi, pastilles de statut
  pages/                transferts, détail, connexion, compte
  lib/fileRules.ts      limites, formats, dossiers exclus, secrets, programmes déguisés
  lib/readDrop.ts       lecture des fichiers et dossiers déposés
  i18n/fr.ts            tous les textes (français pour la bêta)
  demo/demoApi.ts       mode démonstration (données en mémoire)
supabase/
  migrations/           schéma `transfer`, règles d'accès, fonctions SQL
  functions/            fonctions serveur (Deno) et leurs tests
  tests/                tests SQL des règles d'accès
.github/workflows/      vérifications, déploiement Supabase, nettoyage horaire
```
