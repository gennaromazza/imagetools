import type { DesktopIdPhotoPrintRequest, DesktopIdPhotoPrintResult } from "@photo-tools/desktop-contracts";

const MAX_PRINT_PAGES = 48;
const MAX_PAGE_BYTES = 30 * 1024 * 1024;

interface PrintWebContents {
  print: (
    options: Record<string, unknown>,
    callback: (success: boolean, failureReason: string) => void,
  ) => void;
}

export interface IdPhotoPrintWindow {
  webContents: PrintWebContents;
  loadURL: (url: string) => Promise<void>;
  isDestroyed: () => boolean;
  destroy: () => void;
}

export type CreateIdPhotoPrintWindow = () => IdPhotoPrintWindow;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function validateIdPhotoPrintRequest(request: DesktopIdPhotoPrintRequest): void {
  if (!request || !Number.isFinite(request.sheetWidthMm) || !Number.isFinite(request.sheetHeightMm)) {
    throw new Error("Dimensioni del foglio di stampa non valide.");
  }
  if (request.sheetWidthMm < 25 || request.sheetWidthMm > 500
    || request.sheetHeightMm < 25 || request.sheetHeightMm > 500) {
    throw new Error("Dimensioni del foglio fuori dai limiti supportati.");
  }
  if (!Array.isArray(request.pages) || request.pages.length === 0 || request.pages.length > MAX_PRINT_PAGES) {
    throw new Error(`La stampa accetta da 1 a ${MAX_PRINT_PAGES} fogli.`);
  }
  for (const page of request.pages) {
    if (!(page.jpegBytes instanceof Uint8Array) || page.jpegBytes.byteLength === 0 || page.jpegBytes.byteLength > MAX_PAGE_BYTES) {
      throw new Error("Dati immagine del foglio non validi.");
    }
  }
}

export function createIdPhotoPrintHtml(request: DesktopIdPhotoPrintRequest): string {
  validateIdPhotoPrintRequest(request);
  const title = escapeHtml(request.title.trim() || "FileX ID Photo");
  const pages = request.pages.map((page, index) => {
    const source = Buffer.from(page.jpegBytes).toString("base64");
    return `<section class="page"><img src="data:image/jpeg;base64,${source}" alt="Foglio ${index + 1}"></section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
@page { size: ${request.sheetWidthMm}mm ${request.sheetHeightMm}mm; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.page { width: ${request.sheetWidthMm}mm; height: ${request.sheetHeightMm}mm; margin: 0; overflow: hidden; break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
.page img { display: block; width: 100%; height: 100%; object-fit: fill; }
</style></head><body>${pages}</body></html>`;
}

export async function printIdPhotoPagesDesktop(
  request: DesktopIdPhotoPrintRequest,
  createWindow: CreateIdPhotoPrintWindow,
): Promise<DesktopIdPhotoPrintResult> {
  const html = createIdPhotoPrintHtml(request);
  const printWindow = createWindow();
  try {
    await printWindow.loadURL(`data:text/html;base64,${Buffer.from(html, "utf8").toString("base64")}`);
    return await new Promise((resolve) => {
      printWindow.webContents.print({
        silent: false,
        printBackground: true,
        margins: { marginType: "none" },
        pageSize: {
          width: Math.round(request.sheetWidthMm * 1000),
          height: Math.round(request.sheetHeightMm * 1000),
        },
      }, (success, failureReason) => {
        if (success) {
          resolve({ status: "submitted" });
        } else if (/cancel/iu.test(failureReason)) {
          resolve({ status: "cancelled" });
        } else {
          resolve({ status: "failed", error: failureReason || "Il driver di stampa non ha accettato il lavoro." });
        }
      });
    });
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}
