import assert from "node:assert/strict";
import test from "node:test";
import {
  googleDriveApiDisabledMessage,
  googleDriveFileUrl,
} from "../apps/filex-desktop/src/google-drive-link.ts";

test("usa il link web restituito da Google Drive", () => {
  assert.equal(
    googleDriveFileUrl("file-id", "https://drive.google.com/file/d/file-id/view?usp=drivesdk"),
    "https://drive.google.com/file/d/file-id/view?usp=drivesdk",
  );
});

test("genera un link Drive sicuro quando Google non restituisce webViewLink", () => {
  assert.equal(
    googleDriveFileUrl("file id/1"),
    "https://drive.google.com/file/d/file%20id%2F1/view",
  );
});

test("traduce l'errore di API Drive disabilitata", () => {
  assert.match(
    googleDriveApiDisabledMessage("Google Drive API has not been used in project 391620173227 before") ?? "",
    /non è attiva/u,
  );
  assert.equal(googleDriveApiDisabledMessage("quota exceeded"), null);
});
