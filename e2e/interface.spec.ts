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

test("le panneau de partage affiche le code de la liste", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  const code = page.url().split("/l/")[1];
  await page.click("#btn-share");
  await expect(page.locator("#share-code")).toHaveText(code);
});
