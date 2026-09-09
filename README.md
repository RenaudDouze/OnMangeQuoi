# OnMangeQuoi

Une liste de repas partagée en temps réel, sur le même modèle que
[KoiKiManke](https://github.com/RenaudDouze/KoiKiManke) (liste de courses) :
à héberger entièrement sur Cloudflare (Workers + Durable Objects, sans base
de données externe).

## Fonctionnalités

- **Partage en temps réel** : chaque liste vit dans un Durable Object
  identifié par un code à 6 caractères ; tous les appareils connectés sont
  synchronisés instantanément via WebSocket. Pas de compte : le code (ou le
  lien `/l/CODE`) est le seul contrôle d'accès.
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

## Confidentialité

Le seul contrôle d'accès à une liste est son code à 6 caractères : il n'y a
ni compte, ni mot de passe, ni chiffrement des données stockées. Toute
personne qui obtient le code peut voir et modifier la liste.

## Stack technique

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) +
  [Durable Objects](https://developers.cloudflare.com/durable-objects/)
  (une instance par liste, stockage + diffusion WebSocket).
- [Vite](https://vite.dev/) + [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/)
  pour un dev loop unique (front + Worker tournent dans le même processus).
- TypeScript, sans framework front (DOM direct) pour rester léger.

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

## Structure du projet

```
worker/            Worker Cloudflare (routes API), Durable Object MealRoom,
                    et reducer.ts (logique pure, testée unitairement)
shared/            Types partagés entre le Worker et le client
src/                Application front (vue Accueil / vue Liste)
wrangler.json       Configuration Cloudflare (Durable Object, assets SPA)
```

## Qualité

```bash
npm run lint          # oxlint
npm run typecheck
npm run test:coverage # Vitest — logique pure (shared/, worker/reducer.ts)
```

`worker/mealRoom.ts` (la fine couche Durable Object : stockage, WebSocket)
n'est volontairement pas couvert par les tests unitaires — toute sa logique
métier vit dans `worker/reducer.ts`, entièrement testé.

## Modèle de données

Chaque liste est un unique objet JSON stocké dans son Durable Object :
repas actifs (`meals`) et repas archivés (`archive`, ceux passés à "Fait").
Les mutations (ajout, changement de statut, note, commentaires…) sont
envoyées en WebSocket sous forme de petits messages typés
(`shared/types.ts`), appliquées côté serveur, persistées puis rediffusées à
tous les clients connectés.
