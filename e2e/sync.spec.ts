import { test, expect } from "@playwright/test";

test("deux appareils sur la même liste se synchronisent en temps réel", async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  await page1.goto("/");
  await page1.click("#create-form button[type=submit]");
  await page1.waitForURL(/\/l\//);
  const code = page1.url().split("/l/")[1];
  await expect(page1.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page2.goto(`/l/${code}`);
  await expect(page2.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page1.fill("#add-title", "Gratin de courgettes");
  await page1.click("#add-form button[type=submit]");

  await expect(page2.locator(".meal-title")).toHaveText("Gratin de courgettes", { timeout: 5000 });

  await page1.click("#list-title");
  await page1.fill("#list-title .inline-edit", "Repas renommés");
  await page1.keyboard.press("Enter");
  await expect(page2.locator("#list-title")).toHaveText("Repas renommés", { timeout: 5000 });

  // Un changement de statut fait depuis un appareil (archivage, confirmé via
  // la modale de note/commentaire) se reflète aussi chez l'autre : le repas
  // disparaît de sa liste active.
  await page2.click('.status-pill[data-status="fait"]');
  await page2.click("#mark-done-confirm");
  await expect(page1.locator(".meal-card")).toHaveCount(0, { timeout: 5000 });

  await ctx1.close();
  await ctx2.close();
});

test("un repas en cours de création n'est pas effacé par une mise à jour reçue en direct (régression)", async ({ browser }) => {
  // Verrouille le comportement suivant : le rendu déclenché par un message
  // WebSocket entrant ne doit jamais toucher le champ de saisie du
  // formulaire d'ajout — sinon un titre en cours de frappe serait perdu dès
  // qu'un autre appareil modifie la liste au même moment.
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  await page1.goto("/");
  await page1.click("#create-form button[type=submit]");
  await page1.waitForURL(/\/l\//);
  const code = page1.url().split("/l/")[1];
  await expect(page1.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page2.goto(`/l/${code}`);
  await expect(page2.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  // page1 commence à taper mais n'envoie pas encore.
  await page1.fill("#add-title", "Chili con carne");

  // page2 déclenche une diffusion d'état pendant que page1 est en train de taper.
  await page2.fill("#add-title", "Soupe de légumes");
  await page2.click("#add-form button[type=submit]");
  await expect(page1.locator(".meal-title", { hasText: "Soupe de légumes" })).toBeVisible({ timeout: 5000 });

  // Le texte tapé sur page1 doit avoir survécu à la mise à jour reçue.
  await expect(page1.locator("#add-title")).toHaveValue("Chili con carne");

  await page1.click("#add-form button[type=submit]");
  await expect(page1.locator(".meal-title", { hasText: "Chili con carne" })).toBeVisible();

  await ctx1.close();
  await ctx2.close();
});
