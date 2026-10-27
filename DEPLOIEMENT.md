# Mettre ORION Transfer en ligne

Ce guide part du code prêt dans ce dépôt. Le stockage se fait dans Supabase (Cloudflare R2 n'est plus utilisé). Chaque étape se fait une seule fois, dans un navigateur. Comptez environ 45 minutes en tout.

Les étapes marquées **Associé** touchent la base Supabase partagée avec ORION Core : faites-les avec la personne responsable de Core.

---

## 1. Vercel — mettre le site en ligne (10 min)

1. Sur [vercel.com](https://vercel.com), ouvrez **Add New → Project** et importez le dépôt `oriononevision/orion-transfer`.
2. Vercel reconnaît Vite. Ne changez rien aux réglages de build.
3. Dans **Environment Variables**, ajoutez :
   - `VITE_SUPABASE_URL` : la même valeur que dans le `.env` de ORION Core ;
   - `VITE_SUPABASE_ANON_KEY` : la même valeur que dans le `.env` de ORION Core (clé publique « anon ») ;
   - `VITE_CORE_URL` : l'adresse de ORION Core en ligne.
4. Cliquez **Deploy** et notez l'adresse obtenue, par exemple `https://orion-transfer.vercel.app`. Ci-dessous, on l'appelle **ADRESSE**.

> L'offre gratuite de Vercel (Hobby) est réservée à un usage non commercial. Pour un usage interne, vérifiez les conditions. Pour ouvrir le service à des clients, passez à l'offre Pro.

## 2. Supabase — préparer la base (Associé, 10 min)

1. Relisez ensemble `supabase/migrations/20261027000000_transfer_schema.sql`. Il ne crée que le schéma `transfer` et ne modifie aucune table de Core.
2. **Settings → API → Exposed schemas** : ajoutez `transfer`.
3. **Authentication → URL Configuration → Redirect URLs** : ajoutez `ADRESSE/auth/callback` et `http://localhost:5175/auth/callback`.
4. **Account → Access Tokens** : révoquez l'ancienne clé `sbp_…` partagée dans une conversation, puis créez-en une nouvelle réservée au déploiement. Elle ira **uniquement** dans les secrets GitHub (étape 5).
5. Notez la **référence du projet** (Settings → General → Reference ID) et le **mot de passe de la base**.

## 3. Stockage des fichiers — Supabase Storage

Rien à faire à la main : la migration crée elle-même le bucket **privé** `orion-transfer` dans Supabase Storage. Les fichiers ne sortent que par des liens signés de courte durée.

Les envois jusqu’à **1 Go** utilisent Supabase Storage : chaque fichier est découpé automatiquement en morceaux < 50 Mo (plafond de l’offre gratuite), puis reassembled au téléchargement.

## 4. Resend — e-mails d'invitation (facultatif au début)

Sans cette étape, tout fonctionne sauf l'e-mail « X vous a envoyé des fichiers ». Le destinataire voit quand même le transfert en se connectant avec son adresse.

1. Créez un compte sur [resend.com](https://resend.com) et vérifiez votre domaine en ajoutant les enregistrements DNS indiqués.
2. Créez une clé API (**API Keys**).
3. Expéditeur : par exemple `ORION Transfer <transfer@votre-domaine>`.
4. **Recommandé (Associé)** : dans Supabase, ouvrez **Authentication → SMTP Settings** et branchez le serveur SMTP de Resend. Le serveur d'e-mails par défaut de Supabase n'envoie que très peu de liens de connexion par heure.

## 5. GitHub — enregistrer les secrets (5 min)

Dans le dépôt, ouvrez **Settings → Secrets and variables → Actions → New repository secret** :

| Nom | Valeur |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | la nouvelle clé de l'étape 2.4 |
| `SUPABASE_PROJECT_REF` | la référence du projet |
| `SUPABASE_DB_PASSWORD` | le mot de passe de la base |
| `APP_URL` | ADRESSE |
| `ALLOWED_ORIGINS` | `ADRESSE,http://localhost:5175` |
| `CRON_SECRET` | une longue chaîne aléatoire (par exemple générée par un gestionnaire de mots de passe) |
| `RESEND_API_KEY` | la clé Resend (facultatif) |
| `MAIL_FROM` | l'expéditeur (facultatif) |

## 6. Déployer la base et les fonctions (2 min)

Onglet **Actions → Déployer sur Supabase → Run workflow**. Cochez **Appliquer aussi les migrations** la première fois.

Ensuite, à chaque modification des fonctions serveur, relancez ce même bouton sans cocher la case. Le site, lui, se redéploie tout seul sur Vercel à chaque envoi de code sur `main`.

Le nettoyage des transferts expirés tourne automatiquement toutes les heures (workflow « Nettoyage des transferts expirés »).

## 7. Premier essai

1. Ouvrez ADRESSE et connectez-vous avec votre compte ORION.
2. Envoyez un petit fichier à votre associé.
3. Vérifiez qu'il reçoit l'e-mail (si Resend est branché), qu'il voit le transfert et qu'il peut le télécharger.
4. Vérifiez de votre côté que le statut passe à « Téléchargé ».

En cas de problème :

| Symptôme | Cause probable |
|---|---|
| « Impossible de charger vos transferts » | Le schéma `transfer` n'est pas dans Exposed schemas (étape 2.2), ou la migration n'est pas appliquée. |
| L'envoi échoue juste après « Envoyer » | Le bucket `orion-transfer` n'existe pas (migration non appliquée) ou le fichier dépasse 50 Mo. |
| Erreur « Une erreur est survenue » à l'envoi | Un secret manque côté fonctions. Consultez Supabase → Edge Functions → Logs. |
| Le lien de connexion ramène à la page de connexion | ADRESSE/auth/callback manque dans les Redirect URLs (étape 2.3). |
