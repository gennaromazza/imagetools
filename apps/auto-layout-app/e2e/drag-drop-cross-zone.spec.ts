import { expect, test, type Page } from "@playwright/test";

async function completeManualWizard(page: Page) {
  const wizard = page.locator(".wizard-modal");

  await page.getByRole("button", { name: /nuovo progetto|primo progetto/i }).first().click();
  await expect(wizard).toBeVisible();
  await expect(wizard.getByRole("heading", { name: /Benvenuto in Auto Layout/i })).toBeVisible();

  await wizard.getByRole("button", { name: "Inizia" }).click();
  await expect(wizard.getByRole("heading", { name: /Dai un nome al progetto/i })).toBeVisible();
  await wizard.getByRole("button", { name: "Continua" }).click();

  await expect(wizard.getByRole("heading", { name: /Scegli il flusso di lavoro/i })).toBeVisible();
  await wizard.getByRole("radio", { name: /Impaginazione libera/i }).check();
  await wizard.getByRole("spinbutton", { name: "Numero fogli iniziali" }).fill("1");
  await wizard.getByRole("button", { name: "Continua" }).click();

  await expect(wizard.getByRole("heading", { name: /Carica le foto/i })).toBeVisible();
  await wizard.getByRole("button", { name: /foto demo/i }).click();
  await expect(wizard.locator(".status-badge__value")).not.toHaveText("0");
  await wizard.getByRole("button", { name: "Continua" }).click();

  await expect(wizard.getByRole("heading", { name: /Seleziona le foto da impaginare/i })).toBeVisible();
  await wizard.getByRole("button", { name: "Continua" }).click();
  await expect(wizard.getByRole("heading", { name: /Scegli il formato foglio/i })).toBeVisible();
  await wizard.getByRole("button", { name: "Continua" }).click();

  await expect(wizard.getByRole("heading", { name: /Anteprima del progetto/i })).toBeVisible();
  await wizard.getByRole("button", { name: "Accedi allo studio" }).click();
  await expect(page.locator(".layout-studio")).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.clear();
  });
});

test("crea fogli da drag&drop cross-zona: dropzone + canvas vuoto", async ({ page }) => {
  await page.goto("/");
  await completeManualWizard(page);

  const pageTabs = page.getByTestId("studio-page-tab");
  const ribbonPhotos = page.locator(".layout-photo-ribbon__track .ribbon-photo");

  await expect(pageTabs).toHaveCount(1);
  expect(await ribbonPhotos.count()).toBeGreaterThan(1);

  await ribbonPhotos.nth(0).dragTo(page.getByTestId("new-page-dropzone"));
  await expect(pageTabs).toHaveCount(2);

  const canvas = page.getByTestId("studio-canvas");
  const targetPosition = await canvas.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const margin = 16;

    for (let y = rect.top + margin; y <= rect.bottom - margin; y += 24) {
      for (let x = rect.right - margin; x >= rect.left + margin; x -= 24) {
        const element = document.elementFromPoint(x, y);
        if (!element || !node.contains(element)) {
          continue;
        }

        if (element.closest(".layout-studio__page-card, .transfer-tray, .layout-studio__drag-dock")) {
          continue;
        }

        return {
          x: x - rect.left,
          y: y - rect.top
        };
      }
    }

    return null;
  });
  expect(targetPosition).not.toBeNull();

  await ribbonPhotos.nth(1).dragTo(canvas, {
    targetPosition: targetPosition ?? undefined
  });
  await expect(pageTabs).toHaveCount(3);
});
