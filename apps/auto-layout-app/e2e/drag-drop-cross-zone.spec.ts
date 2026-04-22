import { expect, test, type Locator, type Page } from "@playwright/test";

async function completeManualWizard(page: Page) {
  const wizard = page.locator(".wizard-modal");

  await page.getByRole("button", { name: /nuovo progetto|primo progetto/i }).first().click();
  await expect(wizard).toBeVisible();
  await expect(wizard.getByRole("heading", { name: /Benvenuto in ImageAlbumMaker/i })).toBeVisible();

  await wizard.getByRole("button", { name: "Inizia" }).click();
  await expect(wizard.getByRole("heading", { name: /Dai un nome al progetto/i })).toBeVisible();
  await wizard.getByRole("button", { name: "Continua" }).click();

  await expect(wizard.getByRole("heading", { name: /Scegli il flusso di lavoro/i })).toBeVisible();
  await wizard.getByRole("radio", { name: /Impaginazione libera/i }).check();
  await wizard.getByRole("button", { name: "Continua" }).click();

  await expect(wizard.getByRole("heading", { name: /Carica le foto/i })).toBeVisible();
  await wizard.getByRole("button", { name: /foto demo/i }).click();
  await expect(wizard.locator(".status-badge__value")).not.toHaveText("0");
  await wizard.getByRole("button", { name: "Continua" }).click();

  await expect(wizard.getByRole("heading", { name: /Seleziona le foto da impaginare/i })).toBeVisible();
  await wizard.getByRole("button", { name: "Seleziona tutte" }).click();
  await wizard.getByRole("button", { name: "Continua" }).click();
  await expect(wizard.getByRole("heading", { name: /Scegli il formato foglio/i })).toBeVisible();
  await wizard.getByRole("button", { name: "Continua" }).click();

  await expect(wizard.getByRole("heading", { name: /Anteprima del progetto/i })).toBeVisible();
  await wizard.getByRole("button", { name: "Accedi allo studio" }).click();
  await expect(page.locator(".layout-studio")).toBeVisible();
}

function ribbonPhotos(page: Page) {
  return page.locator(".layout-photo-ribbon__track .ribbon-photo");
}

function pageCards(page: Page) {
  return page.locator(".layout-studio__page-card");
}

async function getSlotImageId(slot: Locator): Promise<string | null> {
  return slot.locator(".slot-asset").getAttribute("data-preview-asset-id");
}

async function findSlotByFillState(pageCard: Locator, shouldBeFilled: boolean): Promise<Locator> {
  const slots = pageCard.locator(".sheet-slot");
  const index = await slots.evaluateAll((nodes, targetFilled) => {
    return nodes.findIndex((node) => {
      const imageId = node
        .querySelector(".slot-asset")
        ?.getAttribute("data-preview-asset-id");
      const isFilled = Boolean(imageId);
      return isFilled === targetFilled;
    });
  }, shouldBeFilled);

  expect(index).toBeGreaterThan(-1);
  return slots.nth(index);
}

async function findSlotByImageId(pageCard: Locator, imageId: string): Promise<Locator> {
  const slots = pageCard.locator(".sheet-slot");
  const index = await slots.evaluateAll((nodes, targetImageId) => {
    return nodes.findIndex((node) => {
      const currentImageId = node
        .querySelector(".slot-asset")
        ?.getAttribute("data-preview-asset-id");
      return currentImageId === targetImageId;
    });
  }, imageId);

  expect(index).toBeGreaterThan(-1);
  return slots.nth(index);
}

async function pageContainsImage(pageCard: Locator, imageId: string | null): Promise<boolean> {
  if (!imageId) return false;
  return pageCard
    .locator(".slot-asset")
    .evaluateAll((nodes, targetImageId) =>
      nodes.some((node) => node.getAttribute("data-preview-asset-id") === targetImageId)
    , imageId);
}

async function createEmptySecondPage(page: Page) {
  await page.getByTestId("new-page-button").click();
  await expect(page.getByTestId("studio-page-tab")).toHaveCount(2);
  await expect(pageCards(page)).toHaveCount(2);
}

async function placeFirstRibbonPhotoIntoFirstPage(page: Page) {
  const firstPageCard = pageCards(page).first();
  const emptySlot = await findSlotByFillState(firstPageCard, false);
  await ribbonPhotos(page).first().dragTo(emptySlot.locator(".slot-asset"));
  await expect.poll(async () => getSlotImageId(emptySlot)).not.toBeNull();
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.clear();
  });
});

test.fixme("ribbon -> slot vuoto cross-foglio (add)", async ({ page }) => {
  await page.goto("/");
  await completeManualWizard(page);
  await createEmptySecondPage(page);

  const cards = pageCards(page);
  const targetSlot = await findSlotByFillState(cards.nth(1), false);
  const sourcePhoto = ribbonPhotos(page).nth(0);
  const sourcePhotoId = await sourcePhoto.getAttribute("data-preview-asset-id");

  await sourcePhoto.dragTo(targetSlot.locator(".slot-asset"));
  await expect.poll(async () => pageContainsImage(cards.nth(1), sourcePhotoId)).toBe(true);
});

test.fixme("ribbon -> slot occupato cross-foglio (replace)", async ({ page }) => {
  await page.goto("/");
  await completeManualWizard(page);
  await createEmptySecondPage(page);

  const cards = pageCards(page);
  const pageTwoEmptySlot = await findSlotByFillState(cards.nth(1), false);

  const photoA = ribbonPhotos(page).nth(0);
  const firstPhotoId = await photoA.getAttribute("data-preview-asset-id");
  await photoA.dragTo(pageTwoEmptySlot.locator(".slot-asset"));
  await expect.poll(async () => pageContainsImage(cards.nth(1), firstPhotoId)).toBe(true);

  const photoB = ribbonPhotos(page).nth(1);
  const secondPhotoId = await photoB.getAttribute("data-preview-asset-id");
  expect(secondPhotoId).not.toBe(firstPhotoId);

  const currentSlotForFirstPhoto = await findSlotByImageId(cards.nth(1), firstPhotoId ?? "");
  await photoB.dragTo(currentSlotForFirstPhoto.locator(".slot-asset"));
  await expect.poll(async () => pageContainsImage(cards.nth(1), secondPhotoId)).toBe(true);
  await expect.poll(async () => pageContainsImage(cards.nth(1), firstPhotoId)).toBe(false);
});

test.fixme("slot -> slot occupato cross-foglio (swap)", async ({ page }) => {
  await page.goto("/");
  await completeManualWizard(page);
  await createEmptySecondPage(page);

  const cards = pageCards(page);
  const pageOneFilledSlot = await findSlotByFillState(cards.nth(0), true);
  const pageTwoEmptySlot = await findSlotByFillState(cards.nth(1), false);
  const photoForPageTwo = ribbonPhotos(page).nth(0);
  const photoForPageTwoId = await photoForPageTwo.getAttribute("data-preview-asset-id");
  await photoForPageTwo.dragTo(pageTwoEmptySlot.locator(".slot-asset"));

  const pageTwoFilledSlot = await findSlotByImageId(cards.nth(1), photoForPageTwoId ?? "");
  const pageOneIdBefore = await getSlotImageId(pageOneFilledSlot);
  const pageTwoIdBefore = await getSlotImageId(pageTwoFilledSlot);

  expect(pageOneIdBefore).not.toBeNull();
  expect(pageTwoIdBefore).not.toBeNull();

  await pageOneFilledSlot.locator(".slot-asset").dragTo(pageTwoFilledSlot);

  await expect.poll(async () => getSlotImageId(pageTwoFilledSlot)).toBe(pageOneIdBefore);
  await expect.poll(async () => getSlotImageId(pageOneFilledSlot)).toBe(pageTwoIdBefore);
});

test.fixme("slot -> slot vuoto cross-foglio (move)", async ({ page }) => {
  await page.goto("/");
  await completeManualWizard(page);
  await createEmptySecondPage(page);

  const cards = pageCards(page);
  const pageOneFilledSlot = await findSlotByFillState(cards.nth(0), true);
  const pageTwoEmptySlot = await findSlotByFillState(cards.nth(1), false);
  const movedImageId = await getSlotImageId(pageOneFilledSlot);

  expect(movedImageId).not.toBeNull();
  await pageOneFilledSlot.locator(".slot-asset").dragTo(pageTwoEmptySlot.locator(".slot-asset"));

  await expect.poll(async () => getSlotImageId(pageTwoEmptySlot)).toBe(movedImageId);
  await expect.poll(async () => getSlotImageId(pageOneFilledSlot)).toBeNull();
});

test("slot -> target pagina (tab + header dropzone) sposta senza duplicare", async ({ page }) => {
  await page.goto("/");
  await completeManualWizard(page);
  await placeFirstRibbonPhotoIntoFirstPage(page);
  await createEmptySecondPage(page);

  const tabs = page.getByTestId("studio-page-tab");
  const cards = pageCards(page);
  const pageOneCard = cards.nth(0);
  const pageTwoCard = cards.nth(1);
  const pageOneFilledSlot = await findSlotByFillState(pageOneCard, true);
  const movedImageId = await getSlotImageId(pageOneFilledSlot);

  expect(movedImageId).not.toBeNull();
  await pageOneFilledSlot.locator(".slot-asset").dragTo(tabs.nth(1));
  await expect.poll(async () => pageContainsImage(pageTwoCard, movedImageId)).toBe(true);
  await expect.poll(async () => pageContainsImage(pageOneCard, movedImageId)).toBe(false);

  await page.getByTestId("new-page-button").click();
  await expect(tabs).toHaveCount(3);
  await expect(cards).toHaveCount(3);
  const pageThreeCard = cards.nth(2);
  const pageTwoFilledSlot = await findSlotByImageId(pageTwoCard, movedImageId ?? "");
  const headerDropzone = pageThreeCard.getByTestId("page-header-dropzone");
  await expect(headerDropzone).toBeVisible();
  await expect(headerDropzone).toContainText("Drop su foglio");
  await pageTwoFilledSlot.locator(".slot-asset").dragTo(headerDropzone);
  await expect.poll(async () => pageContainsImage(pageThreeCard, movedImageId)).toBe(true);
  await expect.poll(async () => pageContainsImage(pageTwoCard, movedImageId)).toBe(false);
});

test("slot locked disabilita drag e clear", async ({ page }) => {
  await page.goto("/");
  await completeManualWizard(page);
  await placeFirstRibbonPhotoIntoFirstPage(page);

  const firstPageCard = pageCards(page).first();
  const filledSlot = await findSlotByFillState(firstPageCard, true);

  await filledSlot.click();
  await page.getByRole("checkbox", { name: /blocca questo slot/i }).check();

  await expect(filledSlot.locator(".slot-asset")).toHaveAttribute("draggable", "false");
  await expect(filledSlot.locator(".slot-clear-badge")).toBeDisabled();
});

test("crea fogli da drag&drop cross-zona: dropzone + canvas vuoto", async ({ page }) => {
  await page.goto("/");
  await completeManualWizard(page);

  const tabs = page.getByTestId("studio-page-tab");
  await expect(tabs).toHaveCount(1);
  expect(await ribbonPhotos(page).count()).toBeGreaterThan(1);

  await ribbonPhotos(page).nth(0).dragTo(page.getByTestId("new-page-dropzone"));
  await expect(tabs).toHaveCount(2);

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

        return { x: x - rect.left, y: y - rect.top };
      }
    }

    return null;
  });

  expect(targetPosition).not.toBeNull();
  await ribbonPhotos(page).nth(1).dragTo(canvas, { targetPosition: targetPosition ?? undefined });
  await expect(tabs).toHaveCount(3);
});

test("ribbon mantiene aspect ratio (object-fit contain)", async ({ page }) => {
  await page.goto("/");
  await completeManualWizard(page);

  const objectFit = await ribbonPhotos(page)
    .first()
    .locator(".ribbon-photo__image")
    .evaluate((node) => window.getComputedStyle(node).objectFit);

  expect(objectFit).toBe("contain");
});
