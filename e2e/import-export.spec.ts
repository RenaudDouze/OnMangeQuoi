import { test, expect } from "@playwright/test";
import fs from "node:fs";

test("exporter la liste télécharge un JSON, importable en fusion (dédoublonné par titre) ou en remplacement, et partageable par lien/QR figé", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator(".conn-dot")).toHaveClass(/online/, { timeout: 10_000 });

  await page.fill("#add-title", "Tartiflette");
  await page.click("#add-form button[type=submit]");
  await expect(page.locator(".meal-title")).toHaveText("Tartiflette");

  // Un fichier qui ne ressemble pas à un export de liste de repas est
  // rejeté avec un message clair (pas de modale, pas de plantage).
  await page.click("#menu-toggle-btn");
  await page.click("#btn-import");
  await page.setInputFiles("#import-file-input", { name: "pas-un-export.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect(page.locator(".list-toast")).toContainText("ne ressemble pas à un export");

  await page.click("#menu-toggle-btn");
  const downloadPromise = page.waitForEvent("download");
  await page.click("#btn-export");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const path = await download.path();
  const exported = JSON.parse(fs.readFileSync(path!, "utf-8"));
  expect(exported.meals).toHaveLength(1);
  expect(exported.meals[0].title).toBe("Tartiflette");
  expect(exported.archive).toEqual([]);

  // Fusion : un fichier avec un repas déjà présent (même titre, casse et
  // espaces différents) et un nouveau — seul le nouveau doit être ajouté.
  const mergePayload = JSON.stringify({
    name: "Autre liste",
    meals: [{ title: "  tartiflette  " }, { title: "Raclette" }],
    archive: [],
  });
  await page.click("#menu-toggle-btn");
  await page.click("#btn-import");
  await page.setInputFiles("#import-file-input", { name: "import.json", mimeType: "application/json", buffer: Buffer.from(mergePayload) });
  await expect(page.locator(".modal")).toBeVisible();
  await expect(page.locator(".modal")).toContainText("2 repas trouvé");
  await page.click("#import-merge");
  await expect(page.locator(".meal-card")).toHaveCount(2);
  await expect(page.locator(".meal-title")).toContainText(["Tartiflette", "Raclette"]);
  // Le nom de la liste n'est pas touché par une fusion.
  await expect(page.locator("#list-title")).not.toHaveText("Autre liste");

  // Remplacement : demande une confirmation (window.confirm), puis vide et
  // recharge entièrement la liste actuelle avec le contenu importé.
  const replacePayload = JSON.stringify({ name: "Liste remplacée", meals: [{ title: "Couscous" }], archive: [] });
  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#menu-toggle-btn");
  await page.click("#btn-import");
  await page.setInputFiles("#import-file-input", { name: "import.json", mimeType: "application/json", buffer: Buffer.from(replacePayload) });
  await page.click("#import-replace");
  await expect(page.locator(".meal-card")).toHaveCount(1);
  await expect(page.locator(".meal-title")).toHaveText("Couscous");

  // Lien/QR de partage figé : un instantané de CETTE liste (pas une liste à
  // part — réutilisée pour ne pas cumuler les créations de liste dans la
  // même fenêtre de la limite de débit locale, voir CLAUDE.md), sans code
  // ni synchronisation, ouvert depuis l'accueil pour créer une nouvelle
  // liste à partir de son contenu.
  await page.click("#menu-toggle-btn");
  await page.click("#btn-share");
  await page.click("#btn-snapshot-link");
  await expect(page.locator("#snapshot-qr-wrap svg")).toBeVisible();
  await page.click("#copy-snapshot-link");
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("?import=");
  // Distinct du partage en direct : pas le code de la liste source dans ce lien.
  const code = page.url().split("/l/")[1];
  expect(link).not.toContain(code);

  await page.goto(link);
  await expect(page.locator(".home-header h1")).toHaveText("OnMangeQuoi");
  await expect(page.locator("text=Aperçu de liste partagé")).toBeVisible();
  await expect(page.locator("#import-snapshot-create")).toBeVisible();
  await page.click("#import-snapshot-create");

  await page.waitForURL(/\/l\//);
  await expect(page.locator(".modal")).toBeVisible();
  await expect(page.locator(".modal")).toContainText("1 repas trouvé");
  await page.click("#import-merge");
  await expect(page.locator(".meal-title")).toHaveText("Couscous");
  // La nouvelle liste a bien un code différent de la liste source (partage
  // figé, pas rejoint la liste en direct).
  expect(page.url().split("/l/")[1]).not.toBe(code);
});

test("un lien de partage figé invalide affiche un message d'erreur plutôt qu'un écran vide", async ({ page }) => {
  await page.goto("/?import=pas-un-lien-fige-valide");
  await expect(page.locator("text=Le lien de partage figé est invalide ou corrompu.")).toBeVisible();
});
