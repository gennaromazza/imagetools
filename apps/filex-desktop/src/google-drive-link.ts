export const GOOGLE_DRIVE_API_CONSOLE_URL =
  "https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=391620173227";

export function googleDriveFileUrl(fileId: string, webViewLink?: string): string {
  if (/^https:\/\/drive\.google\.com\//i.test(webViewLink ?? "")) {
    return webViewLink!;
  }
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

export function googleDriveApiDisabledMessage(details: string): string | null {
  if (!/Google Drive API has not been used|SERVICE_DISABLED|accessNotConfigured/i.test(details)) {
    return null;
  }
  return "Google Drive API non è attiva nel progetto FileX. Attivala nella console Google Cloud, attendi alcuni minuti per la propagazione e riprova la sincronizzazione.";
}
