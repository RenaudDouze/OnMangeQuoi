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

  // Premier clic : arme le bouton, ne supprime rien encore.
  await page.click('[data-action="delete"]');
  await expect(page.locator('[data-action="delete"]')).toHaveClass(/confirm-armed/);
  await expect(page.locator(".meal-card")).toHaveCount(1);

  // Second clic au même endroit : confirme la suppression.
  await page.click('[data-action="delete"]');
  await expect(page.locator(".meal-card")).toHaveCount(0);
  await expect(page.locator(".empty-message")).toBeVisible();
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

  // Taper un titre correspondant propose le repas archivé en suggestion.
  await page.fill("#add-title", "tarti");
  await expect(page.locator(".add-suggestion")).toHaveText("Tartiflette");

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

test("au format replié, affiche l'emoji du statut (en cours) ou de la note (historique)", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  // Repas actif : l'emoji du statut "Idée" (par défaut) est visible replié.
  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");
  await expect(page.locator(".meal-collapsed-emoji")).toHaveText("💡");

  // Il suit le statut choisi.
  await page.click('[data-action="toggle"]');
  await page.click('.status-pill[data-status="validee"]');
  await page.click('[data-action="toggle"]');
  await expect(page.locator(".meal-collapsed-emoji")).toHaveText("✅");

  // Passage en "Fait" avec une note : dans l'historique, replié, c'est
  // l'emoji de la note qui s'affiche (plus celui du statut).
  await page.click('[data-action="toggle"]');
  await page.click('.status-pill[data-status="fait"]');
  await page.click('#mark-done-note-picker [data-note="quand_tu_veux"]');
  await page.click("#mark-done-confirm");

  await page.click('.tab-btn[data-tab="archive"]');
  await expect(page.locator(".meal-card")).toHaveCount(1);
  // Toujours ouvert depuis l'étape précédente (l'état replié/déplié suit le
  // repas d'un onglet à l'autre) : le replier pour vérifier l'aperçu.
  await page.click('[data-action="toggle"]');
  await expect(page.locator(".meal-card")).not.toHaveClass(/expanded/);
  await expect(page.locator(".meal-collapsed-emoji")).toHaveText("😍");

  // Un repas archivé sans note n'affiche aucun emoji replié (la note reste
  // mémorisée après une remise en liste : il faut explicitement l'effacer).
  await page.click('[data-action="restore"]');
  await page.click('.tab-btn[data-tab="active"]');
  await page.click('[data-action="toggle"]');
  await page.click('.status-pill[data-status="fait"]');
  await page.click('#mark-done-note-picker [data-note=""]');
  await page.click("#mark-done-confirm");
  await page.click('.tab-btn[data-tab="archive"]');
  await page.click('[data-action="toggle"]');
  await expect(page.locator(".meal-card")).not.toHaveClass(/expanded/);
  await expect(page.locator(".meal-collapsed-emoji")).toHaveCount(0);
});

test("le panneau de partage affiche le code de la liste", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  const code = page.url().split("/l/")[1];
  await page.click("#btn-share");
  await expect(page.locator("#share-code")).toHaveText(code);
});
