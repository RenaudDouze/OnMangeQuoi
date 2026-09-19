import { test, expect } from "@playwright/test";

test("le thème choisi persiste après un rechargement", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);

  await page.click("#theme-toggle");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.click("#theme-toggle");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("le mode « réduire les animations » du système désactive les animations sans passer par le bouton dédié de l'app", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");
  await expect(page.locator("html")).not.toHaveAttribute("data-a11y");

  const transition = await page.locator(".meal-toggle svg").evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(transition).toBe("0s");
});

test("le mode accessibilité s'active, persiste après un rechargement, et se désactive", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-a11y");
  await expect(page.locator("#a11y-toggle")).toHaveAttribute("aria-pressed", "false");

  await page.click("#a11y-toggle");
  await expect(page.locator("html")).toHaveAttribute("data-a11y", "");
  await expect(page.locator("#a11y-toggle")).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-a11y", "");

  await page.click("#a11y-toggle");
  await expect(page.locator("html")).not.toHaveAttribute("data-a11y");
  await expect(page.locator("#a11y-toggle")).toHaveAttribute("aria-pressed", "false");
});

test("supprimer un repas demande un second clic au même endroit", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Pommes au four");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Pommes au four");

  // Repliée, la carte ne montre pas le bouton supprimer (action destructive,
  // rare) : il faut déplier pour y accéder.
  await page.click('[data-action="toggle"]');

  // Premier clic : arme le bouton, ne supprime rien encore.
  await page.click('[data-action="delete"]');
  await expect(page.locator('[data-action="delete"]')).toHaveClass(/confirm-armed/);
  await expect(page.locator(".meal-card")).toHaveCount(1);

  // Second clic au même endroit : confirme la suppression.
  await page.click('[data-action="delete"]');
  await expect(page.locator(".meal-card")).toHaveCount(0);
  await expect(page.locator(".empty-message")).toBeVisible();
});

test("un nouveau repas apparaît en tête de la liste active", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");

  await page.fill("#add-title", "Curry de légumes");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText(["Curry de légumes", "Tartiflette"]);

  await page.fill("#add-title", "Soupe de légumes");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText(["Soupe de légumes", "Curry de légumes", "Tartiflette"]);
});

test("glisser une carte par sa poignée réordonne la liste active", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await page.fill("#add-title", "Curry de légumes");
  await page.click("#add-form button[type=submit]");
  await page.fill("#add-title", "Soupe de légumes");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText(["Soupe de légumes", "Curry de légumes", "Tartiflette"]);

  // Glisse la première carte ("Soupe de légumes") au-delà de la deuxième :
  // SortableJS (forceFallback: true, voir wireMealList) écoute les
  // événements souris/tactile plutôt que le drag-and-drop HTML5 natif, donc
  // une séquence mouse.down/move/up classique suffit à le déclencher.
  const handle = page.locator(".meal-card").nth(0).locator(".drag-handle");
  const target = page.locator(".meal-card").nth(1);
  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  if (!handleBox || !targetBox) throw new Error("Poignée ou carte cible introuvable");

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height + 5, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator(".meal-title")).toHaveText(["Curry de légumes", "Soupe de légumes", "Tartiflette"]);
});

test("copier le titre d'un repas le place dans le presse-papiers", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");

  // Visible directement sur la ligne repliée, pas besoin de déplier la carte.
  await page.click('[data-action="copy-title"]');
  await expect(page.locator("#list-toast")).toContainText("Titre copié.");
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe("Tartiflette");
});

test("le titre d'un repas est éditable au clavier (Entrée), pas seulement au clic", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");

  // role="button" + tabindex="0" sans activation clavier serait un piège :
  // focusable mais inutilisable sans souris (voir onActivate).
  await page.locator('[data-action="edit-title"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".meal-card .inline-edit")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("le titre de la liste est modifiable en ligne, et persiste après rechargement", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.click("#list-title");
  await page.fill("#list-title .inline-edit", "Nos repas de la semaine");
  await page.keyboard.press("Enter");
  // L'éditeur reste affiché (input) le temps de l'aller-retour serveur ;
  // c'est en rechargeant (nouveau montage de la coquille) que le titre
  // confirmé s'affiche comme simple texte — voir la vue synchronisée depuis
  // un autre appareil dans e2e/sync.spec.ts pour la version "temps réel".
  await expect(page.locator("#list-title .inline-edit")).toHaveValue("Nos repas de la semaine");

  await page.reload();
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  await expect(page.locator("#list-title")).toHaveText("Nos repas de la semaine");
});

test("l'onglet Historique affiche un message quand il est vide", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.click('.tab-btn[data-tab="archive"]');
  await expect(page.locator(".empty-message")).toContainText("Aucun repas dans l'historique");
  await expect(page.locator("#add-meal-card")).toBeHidden();
});

test("fermer la modale « Fait » (Échap) rend le focus au bouton qui l'a ouverte", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await page.click('[data-action="toggle"]');

  const faitBtn = page.locator('.status-pill[data-status="fait"]');
  await faitBtn.click();
  await expect(page.locator(".modal")).toBeVisible();

  // Sans restitution explicite du focus, il retomberait sur <body> — un
  // utilisateur clavier/lecteur d'écran perdrait sa position dans la liste.
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal")).toBeHidden();
  await expect(faitBtn).toBeFocused();
});

test("annuler la modale « Fait » ne change ni le statut ni la note/commentaire", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Curry de légumes");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Curry de légumes");
  await page.click('[data-action="toggle"]');

  await page.click('.status-pill[data-status="fait"]');
  await expect(page.locator(".modal")).toBeVisible();
  await page.click('#mark-done-note-picker [data-note="plus_jamais"]');
  await page.fill("#mark-done-comment", "Texte jamais envoyé");
  await page.click("#mark-done-cancel");

  await expect(page.locator(".modal")).toBeHidden();
  await expect(page.locator('.status-pill[data-status="idee"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-field="comment"]')).toHaveValue("");

  // Rouvrir la modale confirme qu'aucune note n'a été envoyée entre-temps.
  await page.click('.status-pill[data-status="fait"]');
  await expect(page.locator('#mark-done-note-picker [data-note=""]')).toHaveAttribute("aria-pressed", "true");
});

test("cliquer « Fait » juste après avoir tapé un commentaire n'en perd pas le contenu (régression)", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await page.click('[data-action="toggle"]');

  // Le clic sur « Fait » déclenche le blur du commentaire (envoi WS) et
  // l'ouverture de la modale dans le même geste, avant que le serveur n'ait
  // pu renvoyer l'état à jour (pas de mise à jour optimiste locale) : la
  // modale doit malgré tout se pré-remplir avec ce qui est affiché à
  // l'écran, pas une version périmée du repas.
  await page.fill('[data-field="comment"]', "Recette de mamie");
  await page.click('.status-pill[data-status="fait"]');
  await expect(page.locator("#mark-done-comment")).toHaveValue("Recette de mamie");
  await page.click("#mark-done-confirm");

  // La carte reste dépliée (expandedIds n'est pas remis à zéro par
  // l'archivage) : pas besoin de recliquer sur le chevron.
  await page.click('.tab-btn[data-tab="archive"]');
  await expect(page.locator('[data-field="comment"]')).toHaveValue("Recette de mamie");
});

test("choisir une suggestion de l'historique reprend le repas archivé plutôt que d'en créer un nouveau", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  // Un repas fait puis archivé, avec une note et un commentaire.
  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");
  await page.click('[data-action="toggle"]');
  await page.fill('[data-field="comment"]', "Recette de mamie");
  await page.locator('[data-field="comment"]').blur();
  // Un aller-retour serveur avant "fait" garantit que la modale s'ouvre sur
  // un repas déjà à jour côté client (pas de mise à jour optimiste locale).
  await page.click('.status-pill[data-status="validee"]');
  await expect(page.locator('.status-pill[data-status="validee"]')).toHaveAttribute("aria-pressed", "true");

  await page.click('.status-pill[data-status="fait"]');
  await page.click('#mark-done-note-picker [data-note="quand_tu_veux"]');
  await page.click("#mark-done-confirm");
  await expect(page.locator(".meal-card")).toHaveCount(0);

  // Taper un titre correspondant propose le repas archivé en suggestion,
  // avec sa note pour rappeler ce qu'on en avait pensé.
  await page.fill("#add-title", "tarti");
  await expect(page.locator(".add-suggestion-title")).toContainText("Tartiflette");
  await expect(page.locator(".add-suggestion-note")).toHaveText("😍 Quand tu veux où tu veux");

  // Le choisir le remet en liste active avec sa note/son commentaire d'origine,
  // au lieu de créer un second repas vierge du même nom.
  await page.click(".add-suggestion");
  await expect(page.locator("#add-title")).toHaveValue("");
  await expect(page.locator(".meal-card")).toHaveCount(1);
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");
  await expect(page.locator('.status-pill[data-status="idee"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-field="comment"]')).toHaveValue("Recette de mamie");

  await page.click('.status-pill[data-status="fait"]');
  await expect(page.locator('#mark-done-note-picker [data-note="quand_tu_veux"]')).toHaveAttribute("aria-pressed", "true");
  await page.click("#mark-done-cancel");

  await page.click('.tab-btn[data-tab="archive"]');
  await expect(page.locator(".empty-message")).toContainText("Aucun repas dans l'historique");
});

test("la recherche filtre l'historique par titre, et n'apparaît que sur cet onglet", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  async function addAndArchive(title: string) {
    await page.fill("#add-title", title);
    await page.click("#add-form button[type=submit]");
    await expect(page.locator(".meal-title").last()).toHaveText(title);
    await page.click(`.meal-card:has-text("${title}") [data-action="toggle"]`);
    await page.click(`.meal-card:has-text("${title}") .status-pill[data-status="fait"]`);
    await page.click("#mark-done-confirm");
  }

  await addAndArchive("Tartiflette");
  await addAndArchive("Tarte aux pommes");
  await addAndArchive("Curry de légumes");

  await expect(page.locator("#search-card")).toBeHidden();

  await page.click('.tab-btn[data-tab="archive"]');
  await expect(page.locator("#search-card")).toBeVisible();
  await expect(page.locator(".meal-card")).toHaveCount(3);

  await page.fill("#archive-search", "tart");
  await expect(page.locator(".meal-card")).toHaveCount(2);
  await expect(page.locator(".meal-title")).toHaveText(["Tarte aux pommes", "Tartiflette"]);

  await page.fill("#archive-search", "introuvable");
  await expect(page.locator(".meal-card")).toHaveCount(0);
  await expect(page.locator(".empty-message")).toContainText("Aucun repas ne correspond à la recherche.");

  await page.click('.tab-btn[data-tab="active"]');
  await expect(page.locator("#search-card")).toBeHidden();
});

test("les repas sont repliés par défaut, s'ouvrent au clic, et « Tout déplier » ouvre tout d'un coup", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");
  await page.fill("#add-title", "Curry de légumes");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-card")).toHaveCount(2);

  // Repliés par défaut : ni le statut ni la source/commentaire ne sont visibles.
  await expect(page.locator(".meal-card.expanded")).toHaveCount(0);
  await expect(page.locator(".status-pill")).toHaveCount(0);

  // Ouvrir un repas au clic sur son chevron ne touche pas l'autre.
  await page.click('.meal-card:has-text("Tartiflette") [data-action="toggle"]');
  await expect(page.locator('.meal-card:has-text("Tartiflette")')).toHaveClass(/expanded/);
  await expect(page.locator('.meal-card:has-text("Curry de légumes")')).not.toHaveClass(/expanded/);
  await expect(page.locator("#toggle-all-btn")).toHaveText("Tout déplier");

  // "Tout déplier" (dans le menu d'actions, voir #menu-toggle-btn) ouvre
  // les repas encore repliés.
  await page.click("#menu-toggle-btn");
  await page.click("#toggle-all-btn");
  await expect(page.locator(".meal-card.expanded")).toHaveCount(2);
  await expect(page.locator("#toggle-all-btn")).toHaveText("Tout replier");

  // Un second clic replie tout.
  await page.click("#menu-toggle-btn");
  await page.click("#toggle-all-btn");
  await expect(page.locator(".meal-card.expanded")).toHaveCount(0);
  await expect(page.locator("#toggle-all-btn")).toHaveText("Tout déplier");
});

test("le bouton supprimer n'apparaît qu'une fois la carte dépliée, et toute la ligne (sauf le titre) déplie/replie", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");

  // Repliée : pas de bouton supprimer, action destructive rare.
  await expect(page.locator('[data-action="delete"]')).toHaveCount(0);

  // Cliquer sur la ligne hors chevron/titre (ici le fond de la ligne, sous
  // le titre — la poignée, plus haute, définit la hauteur de la ligne)
  // déplie aussi.
  const main = page.locator(".meal-main");
  const box = (await main.boundingBox())!;
  await main.click({ position: { x: box.width / 2, y: box.height - 2 } });
  await expect(page.locator(".meal-card")).toHaveClass(/expanded/);
  await expect(page.locator('[data-action="delete"]')).toBeVisible();

  // Cliquer sur le titre édite plutôt que de replier la carte.
  await page.click('[data-action="edit-title"]');
  await expect(page.locator(".meal-card .inline-edit")).toBeVisible();
  await expect(page.locator(".meal-card")).toHaveClass(/expanded/);
  await page.keyboard.press("Escape");
});

test("le liséré de couleur de la carte suit le statut (en cours) ou la note (historique)", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  // Repas actif : le statut "Idée" (par défaut) donne sa couleur au bord de la carte.
  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");
  await expect(page.locator(".meal-card")).toHaveAttribute("data-status", "idee");

  // Il suit le statut choisi.
  await page.click('[data-action="toggle"]');
  await page.click('.status-pill[data-status="validee"]');
  await expect(page.locator(".meal-card")).toHaveAttribute("data-status", "validee");

  // Passage en "Fait" avec une note : dans l'historique, c'est la note qui
  // donne sa couleur à la carte (plus le statut, "Fait" pour tous).
  await page.click('.status-pill[data-status="fait"]');
  await page.click('#mark-done-note-picker [data-note="quand_tu_veux"]');
  await page.click("#mark-done-confirm");

  await page.click('.tab-btn[data-tab="archive"]');
  await expect(page.locator(".meal-card")).toHaveCount(1);
  await expect(page.locator(".meal-card")).toHaveAttribute("data-note", "quand_tu_veux");
  await expect(page.locator(".meal-card")).not.toHaveAttribute("data-status");

  // Un repas archivé sans note n'a pas de liséré de couleur (la note reste
  // mémorisée après une remise en liste : il faut explicitement l'effacer).
  await page.click('[data-action="restore"]');
  await page.click('.tab-btn[data-tab="active"]');
  // La carte est restée dépliée depuis l'étape précédente (l'état
  // replié/déplié suit le repas d'un onglet à l'autre) : le statut est
  // donc déjà accessible sans re-cliquer sur le chevron.
  await page.click('.status-pill[data-status="fait"]');
  await page.click('#mark-done-note-picker [data-note=""]');
  await page.click("#mark-done-confirm");
  await page.click('.tab-btn[data-tab="archive"]');
  await expect(page.locator(".meal-card")).not.toHaveAttribute("data-note");
});

test("un badge emoji de statut/note reste visible carte repliée, en plus du liséré de couleur", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");

  // Visible sans déplier la carte, et reflète le statut par défaut.
  await expect(page.locator(".meal-card")).not.toHaveClass(/expanded/);
  const badge = page.locator(".meal-status-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("aria-label", "💡 Idée");

  // Suit un changement de statut.
  await page.click('[data-action="toggle"]');
  await page.click('.status-pill[data-status="validee"]');
  await page.click('[data-action="toggle"]');
  await expect(page.locator(".meal-card")).not.toHaveClass(/expanded/);
  await expect(badge).toHaveAttribute("aria-label", "✅ Validée");

  // Archivé avec une note : le badge reflète la note plutôt que le statut.
  await page.click('[data-action="toggle"]');
  await page.click('.status-pill[data-status="fait"]');
  await page.click('#mark-done-note-picker [data-note="quand_tu_veux"]');
  await page.click("#mark-done-confirm");
  await page.click('.tab-btn[data-tab="archive"]');
  // La carte reste dépliée depuis l'archivage (expandedIds n'est pas remis
  // à zéro) : la replier explicitement pour vérifier le badge une fois
  // repliée, comme pour les étapes précédentes.
  await page.click('[data-action="toggle"]');
  await expect(page.locator(".meal-card")).not.toHaveClass(/expanded/);
  await expect(badge).toHaveAttribute("aria-label", "😍 Quand tu veux où tu veux");
});

test("le panneau de partage affiche le code de la liste", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  const code = page.url().split("/l/")[1];
  await page.click("#menu-toggle-btn");
  await page.click("#btn-share");
  await expect(page.locator("#share-code")).toHaveText(code);

  // Le QR code de partage s'affiche (rendu asynchrone).
  await expect(page.locator("#qr-wrap svg")).toBeVisible();
  await expect(page.locator("#qr-wrap path")).not.toHaveCount(0);
});

// PNG 1x1 transparent minimal, réutilisé pour l'upload et le collage.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("ajouter des images (upload ou collage) les affiche en galerie avec navigation, et chacune peut être supprimée", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");

  await page.click('[data-action="toggle"]');
  await expect(page.locator('[data-action="add-image"]')).toBeVisible();
  await expect(page.locator(".meal-image-item")).toHaveCount(0);

  await page.setInputFiles('[data-action="image-input"]', {
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(TINY_PNG_BASE64, "base64"),
  });

  // L'indicateur de chargement apparaît dès l'envoi déclenché (avant même
  // la réponse réseau) : sans lui, l'attente donne l'impression que rien
  // ne s'est passé.
  await expect(page.locator(".meal-image-loading")).toBeVisible();

  await expect(page.locator(".meal-image-item")).toHaveCount(1);
  const firstImg = page.locator(".meal-image-item img").first();
  await expect(firstImg).toBeVisible();
  await expect(firstImg).toHaveAttribute("src", /\/images\//);
  await expect(page.locator('[data-action="add-image"]')).toBeVisible();
  await expect(page.locator(".meal-image-loading")).toBeHidden();

  // Coller une seconde image (ex : capture d'écran) l'ajoute à la galerie
  // plutôt que de remplacer la première — événement paste réel plutôt
  // qu'un second upload, pour exercer ce chemin spécifiquement.
  await page.evaluate(async (base64) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const file = new File([blob], "pasted.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.querySelector(".meal-card")!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
  }, TINY_PNG_BASE64);
  await expect(page.locator(".meal-image-item")).toHaveCount(2);

  // Cliquer sur la première miniature l'affiche en plein écran avec un
  // compteur et une navigation suivant/précédent ; la flèche droite passe à
  // la seconde photo, Échap referme.
  await page.locator('[data-action="view-image"]').first().click();
  const lightboxImg = page.locator(".image-lightbox-img");
  await expect(lightboxImg).toBeVisible();
  await expect(page.locator(".image-lightbox-counter")).toHaveText("1 / 2");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".image-lightbox-counter")).toHaveText("2 / 2");
  await page.keyboard.press("Escape");
  await expect(page.locator(".image-lightbox-overlay")).toHaveCount(0);

  // Un clic n'importe où sur l'overlay referme aussi (pas seulement le
  // bouton fermer dédié).
  await page.locator('[data-action="view-image"]').first().click();
  await expect(lightboxImg).toBeVisible();
  await page.click(".image-lightbox-overlay", { position: { x: 5, y: 5 } });
  await expect(page.locator(".image-lightbox-overlay")).toHaveCount(0);

  // Supprimer une photo demande un second clic au même endroit, comme les
  // autres actions destructrices de la carte, et ne retire qu'elle.
  const removeBtn = page.locator('[data-action="remove-image"]').first();
  await removeBtn.click();
  await expect(removeBtn).toHaveClass(/confirm-armed/);
  await removeBtn.click();
  await expect(page.locator(".meal-image-item")).toHaveCount(1);
  await expect(page.locator('[data-action="add-image"]')).toBeVisible();
});

test("le temps de préparation d'un repas se choisit et persiste après rechargement", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await page.click('[data-action="toggle"]');

  // Régression : "Non renseigné" pressé par défaut (nouveau repas) doit
  // rester lisible — le texte blanc de l'état pressé s'était une fois
  // retrouvé sans couleur de fond dédiée, sur le fond clair par défaut.
  const noneBtn = page.locator('.preptime-pill[data-preptime=""]');
  await expect(noneBtn).toHaveAttribute("aria-pressed", "true");
  const [color, background] = await noneBtn.evaluate((el) => {
    const style = getComputedStyle(el);
    return [style.color, style.backgroundColor];
  });
  expect(color).not.toBe(background);

  await page.click('.preptime-pill[data-preptime="long"]');
  await expect(page.locator('.preptime-pill[data-preptime="long"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.preptime-pill[data-preptime=""]')).toHaveAttribute("aria-pressed", "false");

  await page.reload();
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  await page.click('[data-action="toggle"]');
  await expect(page.locator('.preptime-pill[data-preptime="long"]')).toHaveAttribute("aria-pressed", "true");
});

test("le tri automatique par statut réordonne la liste active, indépendamment de l'ordre manuel", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Un");
  await page.click("#add-form button[type=submit]");
  await page.fill("#add-title", "Deux");
  await page.click("#add-form button[type=submit]");
  await page.fill("#add-title", "Trois");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText(["Trois", "Deux", "Un"]);

  // "Trois" (tête de liste) passe en "Non complet" : dans MEAL_STATUSES, ce
  // statut vient après "Idée" (celui de "Deux" et "Un").
  await page.click('.meal-card:has-text("Trois") [data-action="toggle"]');
  await page.click('.meal-card:has-text("Trois") .status-pill[data-status="non_complet"]');

  await expect(page.locator("#sort-toggle-btn")).toHaveText("Trier par statut");
  await page.click("#menu-toggle-btn");
  await page.click("#sort-toggle-btn");
  await expect(page.locator("#sort-toggle-btn")).toHaveText("Tri manuel");
  await expect(page.locator("#sort-toggle-btn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".meal-title")).toHaveText(["Deux", "Un", "Trois"]);

  // Pas de poignée de glissé tant que le tri automatique est actif : le
  // réordonnancement manuel n'aurait pas de sens.
  await expect(page.locator(".drag-handle")).toHaveCount(0);

  // Revenir au tri manuel restaure l'ordre manuel d'origine.
  await page.click("#menu-toggle-btn");
  await page.click("#sort-toggle-btn");
  await expect(page.locator("#sort-toggle-btn")).toHaveText("Trier par statut");
  await expect(page.locator(".meal-title")).toHaveText(["Trois", "Deux", "Un"]);
  await expect(page.locator(".drag-handle")).toHaveCount(3);
});

test("un toast « Annuler » apparaît après avoir modifié un titre ou un commentaire, et restaure l'ancienne valeur", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");

  await page.click('[data-action="edit-title"]');
  await page.fill(".meal-card .inline-edit", "Tartiflette au reblochon");
  await page.keyboard.press("Enter");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette au reblochon");
  await expect(page.locator("#list-toast")).toContainText("Titre modifié.");

  await page.click("#list-toast button");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");

  // Un commentaire modifié propose aussi d'annuler.
  await page.click('[data-action="toggle"]');
  await page.fill('[data-field="comment"]', "Testé une fois, très bon");
  await page.locator('[data-field="comment"]').blur();
  await expect(page.locator("#list-toast")).toContainText("Commentaire modifié.");

  await page.click("#list-toast button");
  await expect(page.locator('[data-field="comment"]')).toHaveValue("");
});

test("le menu d'actions regroupe trier, filtrer, tout déplier et partager, et se referme après une sélection", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  const menu = page.locator("#action-menu");
  await expect(menu).toBeHidden();
  await page.click("#menu-toggle-btn");
  await expect(menu).toBeVisible();
  await expect(page.locator("#sort-toggle-btn")).toBeVisible();
  await expect(page.locator("#filter-toggle-btn")).toBeVisible();
  await expect(page.locator("#toggle-all-btn")).toHaveCount(1);
  await expect(page.locator("#btn-share")).toBeVisible();

  // Sélectionner "Filtrer" ouvre le panneau de filtres et referme le menu
  // (contrairement au panneau lui-même, qui reste ouvert pour cocher
  // plusieurs filtres de suite).
  await page.click("#filter-toggle-btn");
  await expect(menu).toBeHidden();
  await expect(page.locator("#filter-panel")).toBeVisible();

  // Quitter l'onglet actif masque le bouton (comme #sort-toggle-btn) et le
  // panneau ensemble — sans quoi le panneau resterait affiché hors de
  // propos sur l'historique.
  await page.click('.tab-btn[data-tab="archive"]');
  await expect(page.locator("#filter-panel")).toBeHidden();
  await page.click("#menu-toggle-btn");
  await expect(page.locator("#sort-toggle-btn")).toBeHidden();
  await expect(page.locator("#filter-toggle-btn")).toBeHidden();

  await page.click('.tab-btn[data-tab="active"]');
  await page.click("#menu-toggle-btn");
  await expect(page.locator("#filter-toggle-btn")).toBeVisible();
  await expect(page.locator("#filter-panel")).toBeHidden();
});

test("les filtres de la liste active se combinent (statut + temps de préparation) et se réinitialisent", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  // Un nouveau repas apparaît en tête de la liste active (voir prevOrder
  // côté reducer) : ne pas supposer un ordre d'ajout, cibler chaque carte
  // par son titre.
  async function addMeal(title: string) {
    await page.fill("#add-title", title);
    await page.click("#add-form button[type=submit]");
    await expect(page.locator(`.meal-card:has-text("${title}")`)).toBeVisible();
  }

  await addMeal("Tartiflette");
  await addMeal("Curry");
  await addMeal("Salade");

  // Tartiflette : validée, rapide. Curry : idée, long. Salade : idée, rapide.
  await page.click('.meal-card:has-text("Tartiflette") [data-action="toggle"]');
  await page.click('.meal-card:has-text("Tartiflette") .status-pill[data-status="validee"]');
  await page.click('.meal-card:has-text("Tartiflette") .preptime-pill[data-preptime="rapide"]');
  await page.click('.meal-card:has-text("Curry") [data-action="toggle"]');
  await page.click('.meal-card:has-text("Curry") .preptime-pill[data-preptime="long"]');
  await page.click('.meal-card:has-text("Salade") [data-action="toggle"]');
  await page.click('.meal-card:has-text("Salade") .preptime-pill[data-preptime="rapide"]');

  await expect(page.locator(".meal-card")).toHaveCount(3);

  await page.click("#menu-toggle-btn");
  await page.click("#filter-toggle-btn");
  await expect(page.locator("#filter-panel")).toBeVisible();
  await expect(page.locator("#filter-reset-btn")).toBeHidden();

  // Filtre par statut "validée" : seule Tartiflette correspond.
  await page.click('.filter-status-pill[data-status="validee"]');
  await expect(page.locator(".meal-card")).toHaveCount(1);
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");
  await expect(page.locator("#filter-reset-btn")).toBeVisible();

  // Ajouter le filtre "long" en plus (Tartiflette est "rapide", pas "long") :
  // les filtres se combinent (ET), plus aucun résultat.
  await page.click('.filter-preptime-pill[data-preptime="long"]');
  await expect(page.locator(".meal-card")).toHaveCount(0);
  await expect(page.locator(".empty-message")).toContainText("Aucun repas ne correspond aux filtres.");

  // Réinitialiser retrouve les 3 repas et masque à nouveau le bouton.
  await page.click("#filter-reset-btn");
  await expect(page.locator(".meal-card")).toHaveCount(3);
  await expect(page.locator("#filter-reset-btn")).toBeHidden();
});

test("le panneau de statistiques de l'historique résume notes, temps de préparation et repas les plus refaits", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  async function addAndArchive(title: string, note: string) {
    await page.fill("#add-title", title);
    await page.click("#add-form button[type=submit]");
    const card = page.locator(`.meal-card:has-text("${title}")`);
    await expect(card).toBeVisible();
    await card.locator('[data-action="toggle"]').click();
    await card.locator('.status-pill[data-status="fait"]').click();
    await page.click(`#mark-done-note-picker [data-note="${note}"]`);
    await page.click("#mark-done-confirm");
    // Attend que l'archivage soit effectif (aller-retour serveur) avant
    // l'ajout suivant, sans quoi deux repas de même titre pourraient
    // coexister brièvement dans le DOM et rendre le prochain ciblage par
    // titre ambigu.
    await expect(page.locator(".meal-card")).toHaveCount(0);
  }

  await addAndArchive("Tartiflette", "quand_tu_veux");
  await addAndArchive("Tartiflette", "quand_tu_veux");
  await addAndArchive("Curry", "mouais");

  await page.click('.tab-btn[data-tab="archive"]');
  await expect(page.locator(".meal-card")).toHaveCount(3);
  await expect(page.locator("#stats-panel")).toBeHidden();

  await page.click("#stats-toggle-btn");
  await expect(page.locator("#stats-panel")).toBeVisible();
  await expect(page.locator("#stats-panel")).toContainText("3 repas dans l'historique.");
  await expect(page.locator("#stats-panel")).toContainText("Quand tu veux où tu veux");
  await expect(page.locator("#stats-panel")).toContainText("Mouais, ça change mais bon");
  await expect(page.locator("#stats-panel")).toContainText("Les plus refaits");
  await expect(page.locator("#stats-panel")).toContainText("Tartiflette");
});

test("planifier un repas sur aujourd'hui l'affiche dans l'onglet Planning, et « Aujourd'hui »/le retirer fonctionnent", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await page.click('[data-action="toggle"]');

  // Fixe le champ "Jour prévu" à aujourd'hui en déclenchant directement
  // l'événement "change" (voir wireMealCard) : plus robuste qu'un fill()
  // pour un <input type="date">, dont le comportement des événements
  // synthétisés varie selon le navigateur/la version de Playwright.
  await page.evaluate(() => {
    const input = document.querySelector('[data-action="planned-date"]') as HTMLInputElement;
    const d = new Date();
    input.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await page.click('.tab-btn[data-tab="planning"]');
  await expect(page.locator("#meal-list")).toBeHidden();
  await expect(page.locator(".planning-day.today .planning-entry-title")).toHaveText("Tartiflette");

  // Naviguer à la semaine suivante fait disparaître la colonne "today" ;
  // « Aujourd'hui » revient à la semaine courante.
  await page.click("#planning-next");
  await expect(page.locator(".planning-day.today")).toHaveCount(0);
  await page.click("#planning-today-btn");
  await expect(page.locator(".planning-day.today .planning-entry-title")).toHaveText("Tartiflette");

  // Retirer du planning depuis la grille vide aussi le champ "Jour prévu"
  // de la carte (même mécanisme, un seul champ de vérité côté serveur).
  await page.click('.planning-day.today [data-action="unplan"]');
  await expect(page.locator(".planning-day.today .planning-entry-empty")).toBeVisible();
  await page.click('.tab-btn[data-tab="active"]');
  await expect(page.locator('[data-action="planned-date"]')).toHaveValue("");
});

test("changer le statut d'un repas déclenche un retour haptique (vibration courte)", async ({ page }) => {
  // navigator.vibrate n'est pas forcément disponible partout (voir son
  // utilisation en best-effort dans src/views/list.ts) : on le pose ici
  // nous-mêmes, avant tout script de l'app, pour espionner ses appels.
  await page.addInitScript(() => {
    (window as unknown as { __vibrateCalls: number[] }).__vibrateCalls = [];
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: number) => {
        (window as unknown as { __vibrateCalls: number[] }).__vibrateCalls.push(pattern);
        return true;
      },
    });
  });
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await page.click('[data-action="toggle"]');

  await page.click('.status-pill[data-status="validee"]');
  await expect(page.locator('.status-pill[data-status="validee"]')).toHaveAttribute("aria-pressed", "true");
  const calls = await page.evaluate(() => (window as unknown as { __vibrateCalls: number[] }).__vibrateCalls);
  expect(calls).toEqual([10]);

  // Recliquer sur le statut déjà actif ne déclenche pas de second appel :
  // ce n'est pas un vrai changement.
  await page.click('.status-pill[data-status="validee"]');
  const callsAfter = await page.evaluate(() => (window as unknown as { __vibrateCalls: number[] }).__vibrateCalls);
  expect(callsAfter).toEqual([10]);
});
