# OnMangeQuoi

Une liste de repas partagée en temps réel, sur le même modèle que
[KoiKiManke](https://github.com/RenaudDouze/KoiKiManke) (liste de courses) :
à héberger entièrement sur Cloudflare (Workers + Durable Objects, sans base
de données externe).

## Fonctionnalités

- **Partage en temps réel** : chaque liste vit dans un Durable Object
  identifié par un code à 6 caractères ; tous les appareils connectés sont
  synchronisés instantanément via WebSocket. Pas de compte : le code, le
  lien `/l/CODE` ou son QR code sont les seuls moyens d'accès.
- **Statuts de repas** : chaque repas suit un statut — Idée, Validée,
  Commandée, Rangée, Non complet, Fait.
- **Historique** : passer un repas en "Fait" le fait disparaître de la liste
  active ; il est conservé dans l'historique (bouton "Remettre dans la
  liste" pour le proposer à nouveau plus tard).
- **Note** : une fois testé, un repas peut recevoir une note parmi un jeu
  fixe : *Plus jamais*, *Mouais, ça change mais bon*, *En remplaçant ça par
  ça peut-être ?*, *De temps en temps oui*, *Quand tu veux où tu veux*.
- **Source** : un champ libre par repas, lien ou simple texte (site, livre de
  cuisine…) — rendu comme lien cliquable s'il ressemble à une URL.
- **Commentaires avant / après** : deux champs de commentaire libres par
  repas.
- **Thème clair/sombre/auto**.
- **Installable (PWA)** : manifest + service worker, s'ajoute à l'écran
  d'accueil et se relance instantanément (shell mis en cache).

## Confidentialité

Le seul contrôle d'accès à une liste est son code à 6 caractères : il n'y a
ni compte, ni mot de passe, ni chiffrement des données stockées. Toute
personne qui obtient le code peut voir et modifier la liste.

## Stack technique

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) +
  [Durable Objects](https://developers.cloudflare.com/durable-objects/)
  (une instance par liste, stockage + diffusion WebSocket).
- [Vite](https://vite.dev/) + [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/)
  pour un dev loop unique (front + Worker tournent dans le même processus,
  avec `workerd`) + [`vite-plugin-pwa`](https://vite-pwa-org.netlify.app/)
  pour le manifest/service worker.
- TypeScript, sans framework front (DOM direct) pour rester léger.
- [`qrcode`](https://www.npmjs.com/package/qrcode) pour générer le QR code de
  partage côté client.

## Démarrer en local

```bash
npm install
npm run dev
```

Ouvre l'URL affichée (`http://localhost:5173` par défaut). Le plugin
Cloudflare fait tourner le Worker et le Durable Object localement.

## Déployer sur Cloudflare

```bash
npm run deploy
```

Ceci build le front (`vite build`) puis déploie avec `wrangler deploy`. Il
faut être connecté à un compte Cloudflare (`npx wrangler login` la première
fois).

En CI, `.github/workflows/deploy.yml` fait ce déploiement automatiquement à
chaque `CI` réussie sur `main`. Il lui faut deux secrets du dépôt
(Settings → Secrets and variables → Actions → Secrets) :

- `CLOUDFLARE_API_TOKEN` — un token avec les permissions Workers Scripts:Edit
  et Workers Routes:Edit (créable sur
  [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)).
- `CLOUDFLARE_ACCOUNT_ID` — visible dans l'URL du dashboard Cloudflare ou via
  `npx wrangler whoami`.

Une fois le premier déploiement fait (URL `*.workers.dev` connue, ou domaine
personnalisé), renseigne aussi la variable de dépôt `DEPLOY_URL` (Settings →
Secrets and variables → Actions → Variables) avec cette URL : elle sert à la
fois à vérifier le déploiement Cloudflare et à indiquer au build GitHub
Pages (ci-dessous) où trouver l'API.

## Déployer sur GitHub Pages

L'app est aussi accessible via une URL `github.io`, en plus de l'URL
Cloudflare Workers : le client est alors servi par GitHub Pages mais parle
toujours à l'unique Worker Cloudflare (API + WebSocket temps réel) via CORS,
donc les deux URLs donnent accès aux mêmes listes partagées.

C'est géré par `.github/workflows/pages.yml`, qui build le client avec
`VITE_SYNC_WORKER_URL` pointant vers l'URL publique du Worker (variable de
dépôt `vars.DEPLOY_URL`, voir ci-dessus) puis publie `dist/client` sur
GitHub Pages. Il faut activer Pages une première fois dans Settings → Pages
(Source : "GitHub Actions") ; sans `DEPLOY_URL` défini, le build reste
possible mais l'app servie par Pages n'a pas de Worker à qui parler
(créer/rejoindre une liste échouera).

## Structure du projet

```
worker/            Worker Cloudflare (routes API), Durable Object MealRoom,
                    et reducer.ts (logique pure, testée unitairement)
shared/            Types partagés entre le Worker et le client
src/                Application front (vue Accueil / vue Liste)
e2e/                Tests fonctionnels Playwright (parcours principal, sync
                    temps réel multi-appareils)
wrangler.json       Configuration Cloudflare (Durable Object, assets SPA)
```

## Qualité et CI/CD

```bash
npm run lint          # oxlint
npm run typecheck
npm run test:coverage # Vitest — logique pure (shared/, worker/reducer.ts)
npm run test:e2e      # Playwright, contre `vite dev`
```

`worker/mealRoom.ts` (la fine couche Durable Object : stockage, WebSocket)
n'est volontairement pas couvert par les tests unitaires — toute sa logique
métier vit dans `worker/reducer.ts`, entièrement testée.

`.github/workflows/` : `ci.yml` (lint, typecheck, tests + couverture, e2e,
audit, build) puis, une fois la CI verte sur `main`, `deploy.yml`
(déploiement Cloudflare, jamais sur un simple push direct) et `pages.yml`
(publication GitHub Pages). Dependabot et CodeQL sont aussi configurés.

## Modèle de données

Chaque liste est un unique objet JSON stocké dans son Durable Object :
repas actifs (`meals`) et repas archivés (`archive`, ceux passés à "Fait").
Les mutations (ajout, changement de statut, note, commentaires…) sont
envoyées en WebSocket sous forme de petits messages typés
(`shared/types.ts`), appliquées côté serveur, persistées puis rediffusées à
tous les clients connectés.
