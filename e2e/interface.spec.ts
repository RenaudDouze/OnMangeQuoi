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

  // "Tout déplier" ouvre les repas encore repliés.
  await page.click("#toggle-all-btn");
  await expect(page.locator(".meal-card.expanded")).toHaveCount(2);
  await expect(page.locator("#toggle-all-btn")).toHaveText("Tout replier");

  // Un second clic replie tout.
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

test("le panneau de partage affiche le code de la liste", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  const code = page.url().split("/l/")[1];
  await page.click("#btn-share");
  await expect(page.locator("#share-code")).toHaveText(code);

  // Le QR code de partage s'affiche (rendu asynchrone).
  await expect(page.locator("#qr-wrap svg")).toBeVisible();
  await expect(page.locator("#qr-wrap path")).not.toHaveCount(0);
});

// PNG 1x1 transparent minimal, réutilisé pour l'upload et le collage.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("ajouter une image (upload ou collage) l'affiche, et elle peut être supprimée", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");

  await page.click('[data-action="toggle"]');
  await expect(page.locator('[data-action="add-image"]')).toBeVisible();
  await expect(page.locator(".meal-image-preview")).toHaveCount(0);

  await page.setInputFiles('[data-action="image-input"]', {
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(TINY_PNG_BASE64, "base64"),
  });

  // L'indicateur de chargement apparaît dès l'envoi déclenché (avant même
  // la réponse réseau) : sans lui, l'attente donne l'impression que rien
  // ne s'est passé.
  await expect(page.locator(".meal-image-loading")).toBeVisible();

  const img = page.locator(".meal-image-preview img");
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute("src", /\/image\?v=1$/);
  await expect(page.locator('[data-action="add-image"]')).toHaveCount(0);
  await expect(page.locator(".meal-image-loading")).toBeHidden();

  // Cliquer sur la miniature l'affiche en plein écran ; Échap referme.
  await page.click('[data-action="view-image"]');
  const lightboxImg = page.locator(".image-lightbox-img");
  await expect(lightboxImg).toBeVisible();
  await expect(lightboxImg).toHaveAttribute("src", /\/image\?v=1$/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".image-lightbox-overlay")).toHaveCount(0);

  // Un clic n'importe où sur l'overlay referme aussi (pas seulement le
  // bouton fermer dédié).
  await page.click('[data-action="view-image"]');
  await expect(lightboxImg).toBeVisible();
  await page.click(".image-lightbox-overlay", { position: { x: 5, y: 5 } });
  await expect(page.locator(".image-lightbox-overlay")).toHaveCount(0);

  // Remplacer par collage (ex : capture d'écran) — événement paste réel
  // plutôt qu'un second upload, pour exercer ce chemin spécifiquement.
  await page.evaluate(async (base64) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const file = new File([blob], "pasted.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.querySelector(".meal-card")!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
  }, TINY_PNG_BASE64);
  await expect(img).toHaveAttribute("src", /\/image\?v=2$/);

  // Supprimer demande un second clic au même endroit, comme les autres
  // actions destructrices de la carte.
  const removeBtn = page.locator('[data-action="remove-image"]');
  await removeBtn.click();
  await expect(removeBtn).toHaveClass(/confirm-armed/);
  await removeBtn.click();
  await expect(page.locator(".meal-image-preview")).toHaveCount(0);
  await expect(page.locator('[data-action="add-image"]')).toBeVisible();
});
