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

  // Replié par défaut : il faut le déplier pour accéder au statut, à la
  // source et au commentaire.
  await page.click('[data-action="toggle"]');
  await expect(page.locator('.status-pill[data-status="idee"]')).toHaveAttribute("aria-pressed", "true");

  // Source : un lien détecté est rendu cliquable
  await page.click('[data-action="edit-source"]');
  await page.fill(".meal-card .inline-edit", "https://exemple.fr/tartiflette");
  await page.keyboard.press("Enter");
  await expect(page.locator(".meal-source a")).toHaveAttribute("href", "https://exemple.fr/tartiflette");

  // Commentaire (un seul champ, quel que soit le moment où il est écrit)
  await page.fill('[data-field="comment"]', "Ça a l'air simple à faire");
  await page.locator('[data-field="comment"]').blur();

  // Changement de statut : sélecteur visuel (pastilles cliquables), pas de liste déroulante
  await page.click('.status-pill[data-status="validee"]');
  await expect(page.locator('.status-pill[data-status="validee"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.status-pill[data-status="idee"]')).toHaveAttribute("aria-pressed", "false");

  // Passer en "Fait" ouvre une modale proposant de renseigner la note et de
  // compléter le commentaire, pré-rempli avec ce qui a déjà été écrit
  await page.click('.status-pill[data-status="fait"]');
  await expect(page.locator(".modal")).toBeVisible();
  await expect(page.locator("#mark-done-comment")).toHaveValue("Ça a l'air simple à faire");
  await page.click('#mark-done-note-picker [data-note="de_temps_en_temps"]');
  await expect(page.locator('#mark-done-note-picker [data-note="de_temps_en_temps"]')).toHaveAttribute("aria-pressed", "true");
  await page.fill("#mark-done-comment", "Ça a l'air simple à faire. Un peu lourd mais bon.");
  // La date du "fait" est modifiable : utile pour noter un repas après coup.
  await page.fill("#mark-done-date", "2024-01-15");
  await page.click("#mark-done-confirm");

  await expect(page.locator(".meal-card")).toHaveCount(0);
  await expect(page.locator(".list-toast")).toContainText("déplacé vers l'historique");

  // Il apparaît dans l'historique, commentaire déjà renseigné (la note ne
  // s'affiche nulle part sur la carte : elle ne se voit/modifie que via la
  // modale "Fait"), avec la date choisie dans la modale
  await page.click('.tab-btn[data-tab="archive"]');
  await expect(page.locator(".meal-card")).toHaveCount(1);
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");
  await expect(page.locator(".status-badge")).toContainText("15 janv. 2024");
  await expect(page.locator(".meal-note")).toHaveCount(0);
  await expect(page.locator('[data-field="comment"]')).toHaveValue("Ça a l'air simple à faire. Un peu lourd mais bon.");

  // Remise en liste : redevient actif avec le statut réinitialisé, commentaire conservé
  await page.click('[data-action="restore"]');
  await expect(page.locator(".meal-card")).toHaveCount(0);
  await page.click('.tab-btn[data-tab="active"]');
  await expect(page.locator(".meal-card")).toHaveCount(1);
  await expect(page.locator('.status-pill[data-status="idee"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-field="comment"]')).toHaveValue("Ça a l'air simple à faire. Un peu lourd mais bon.");

  // La note reste malgré tout mémorisée : en rouvrant la modale "Fait", elle
  // est pré-sélectionnée.
  await page.click('.status-pill[data-status="fait"]');
  await expect(page.locator('#mark-done-note-picker [data-note="de_temps_en_temps"]')).toHaveAttribute("aria-pressed", "true");
  await page.click("#mark-done-cancel");
});

test("un code inconnu affiche un message clair plutôt qu'un écran vide", async ({ page }) => {
  await page.goto("/l/ZZZZZZ");
  await expect(page.locator(".centered-message")).toContainText("Aucune liste ne correspond au code");
});
