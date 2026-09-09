import { test, expect } from "@playwright/test";

test("parcours complet : créer, ajouter un repas, le compléter, le noter et le remettre en liste", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".home-header h1")).toHaveText("OnMangeQuoi");

  // Création d'une liste
  await page.fill("#create-name", "Repas de la semaine");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  // Ajout d'un repas
  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");
  await expect(page.locator(".meal-status")).toHaveValue("idee");

  // Source : un lien détecté est rendu cliquable
  await page.click('[data-action="edit-source"]');
  await page.fill(".meal-card .inline-edit", "https://exemple.fr/tartiflette");
  await page.keyboard.press("Enter");
  await expect(page.locator(".meal-source a")).toHaveAttribute("href", "https://exemple.fr/tartiflette");

  // Commentaire avant
  await page.fill('[data-field="commentBefore"]', "Ça a l'air simple à faire");
  await page.locator('[data-field="commentBefore"]').blur();

  // Changement de statut
  await page.selectOption(".meal-status", "validee");
  await expect(page.locator(".meal-status")).toHaveValue("validee");

  // Passer en "Fait" fait disparaître le repas de la liste active
  await page.selectOption(".meal-status", "fait");
  await expect(page.locator(".meal-card")).toHaveCount(0);
  await expect(page.locator(".list-toast")).toContainText("déplacé vers l'historique");

  // Il apparaît dans l'historique
  await page.click('.tab-btn[data-tab="archive"]');
  await expect(page.locator(".meal-card")).toHaveCount(1);
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");
  await expect(page.locator(".status-badge")).toBeVisible();

  // On peut y laisser une note et un commentaire "après"
  await page.selectOption(".meal-note", "de_temps_en_temps");
  await page.fill('[data-field="commentAfter"]', "Un peu lourd mais bon");
  await page.locator('[data-field="commentAfter"]').blur();

  // Remise en liste : redevient actif avec le statut réinitialisé, note conservée
  await page.click('[data-action="restore"]');
  await expect(page.locator(".meal-card")).toHaveCount(0);
  await page.click('.tab-btn[data-tab="active"]');
  await expect(page.locator(".meal-card")).toHaveCount(1);
  await expect(page.locator(".meal-status")).toHaveValue("idee");
  await expect(page.locator(".meal-note")).toHaveValue("de_temps_en_temps");
});

test("un code inconnu affiche un message clair plutôt qu'un écran vide", async ({ page }) => {
  await page.goto("/l/ZZZZZZ");
  await expect(page.locator(".centered-message")).toContainText("Aucune liste ne correspond au code");
});
