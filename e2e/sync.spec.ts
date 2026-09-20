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
  await page2.click('[data-action="toggle"]');
  await page2.click('.status-pill[data-status="fait"]');
  await page2.click("#mark-done-confirm");
  await expect(page1.locator(".meal-card")).toHaveCount(0, { timeout: 5000 });

  await ctx1.close();
  await ctx2.close();
});

test("les notifications signalent un ajout ou un changement de statut fait par un autre appareil, jamais ses propres actions", async ({ browser }) => {
  const ctx1 = await browser.newContext({ permissions: ["notifications"] });
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  // Espionne les notifications affichées sur page1 (celle qui les active) :
  // aucun service worker n'est enregistré en dev (voir
  // showBrowserNotification, src/views/list.ts), donc new Notification()
  // est bien le chemin emprunté ici, pas registration.showNotification().
  await page1.addInitScript(() => {
    (window as unknown as { __notifications: { title: string; body: string }[] }).__notifications = [];
    class FakeNotification {
      static permission = "granted";
      static requestPermission(): Promise<NotificationPermission> {
        return Promise.resolve("granted");
      }
      constructor(title: string, options?: NotificationOptions) {
        (window as unknown as { __notifications: { title: string; body: string }[] }).__notifications.push({
          title,
          body: options?.body ?? "",
        });
      }
    }
    Object.defineProperty(window, "Notification", { configurable: true, value: FakeNotification });
  });

  await page1.goto("/");
  await page1.click("#create-form button[type=submit]");
  await page1.waitForURL(/\/l\//);
  const code = page1.url().split("/l/")[1];
  await expect(page1.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page2.goto(`/l/${code}`);
  await expect(page2.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page1.click("#menu-toggle-btn");
  await page1.click("#notif-toggle-btn");
  await expect(page1.locator("#notif-toggle-btn")).toHaveAttribute("aria-pressed", "true");

  const notifications = () =>
    page1.evaluate(() => (window as unknown as { __notifications: { title: string; body: string }[] }).__notifications);

  // Sa propre action (ajouter un repas) ne se notifie pas elle-même.
  await page1.fill("#add-title", "Tartiflette");
  await page1.click("#add-form button[type=submit]");
  await expect(page1.locator(".meal-title")).toHaveText("Tartiflette");
  await page1.waitForTimeout(200);
  expect(await notifications()).toEqual([]);

  // Un ajout depuis l'autre appareil, si.
  await page2.fill("#add-title", "Curry de légumes");
  await page2.click("#add-form button[type=submit]");
  await expect(page1.locator(".meal-title")).toHaveText(["Curry de légumes", "Tartiflette"], { timeout: 5000 });
  await expect.poll(async () => (await notifications()).length).toBe(1);
  expect((await notifications())[0].body).toContain("Curry de légumes");

  // Un changement de statut depuis l'autre appareil aussi.
  await page2.click('.meal-card:has-text("Tartiflette") [data-action="toggle"]');
  await page2.click('.meal-card:has-text("Tartiflette") .status-pill[data-status="validee"]');
  await expect.poll(async () => (await notifications()).length).toBe(2);
  expect((await notifications())[1].body).toContain("Tartiflette");

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

test("un commentaire en cours de frappe n'est pas effacé par une mise à jour reçue en direct (régression)", async ({ browser }) => {
  // Même principe que le test précédent, mais pour le commentaire d'une
  // carte plutôt que le formulaire d'ajout : renderMeals() ne doit jamais
  // reconstruire la carte du repas actuellement en cours d'édition (elle
  // gèle celle où le focus est dans un champ texte), sous peine de perdre un
  // commentaire pas encore validé (pas de blur) dès qu'un autre appareil
  // modifie la liste au même moment.
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  await page1.goto("/");
  await page1.click("#create-form button[type=submit]");
  await page1.waitForURL(/\/l\//);
  const code = page1.url().split("/l/")[1];
  await expect(page1.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page1.fill("#add-title", "Tartiflette");
  await page1.click("#add-form button[type=submit]");
  await expect(page1.locator(".meal-title")).toHaveText("Tartiflette");
  await page1.click('[data-action="toggle"]');

  await page2.goto(`/l/${code}`);
  await expect(page2.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  await expect(page2.locator(".meal-title")).toHaveText("Tartiflette", { timeout: 5000 });
  await page2.click('[data-action="toggle"]');

  // page1 commence à taper un commentaire mais ne le valide pas (pas de blur).
  await page1.fill('[data-field="comment"]', "Recette de mamie");

  // page2 déclenche une diffusion d'état (un ajout) pendant que page1 tape.
  await page2.fill("#add-title", "Soupe de légumes");
  await page2.click("#add-form button[type=submit]");
  await expect(page1.locator(".meal-title", { hasText: "Soupe de légumes" })).toBeVisible({ timeout: 5000 });

  // Le commentaire non encore validé doit avoir survécu à la reconstruction
  // de la liste déclenchée par l'ajout reçu de page2.
  await expect(page1.locator('[data-field="comment"]')).toHaveValue("Recette de mamie");

  await page1.locator('[data-field="comment"]').blur();
  await expect(page2.locator('[data-field="comment"]')).toHaveValue("Recette de mamie", { timeout: 5000 });

  await ctx1.close();
  await ctx2.close();
});
