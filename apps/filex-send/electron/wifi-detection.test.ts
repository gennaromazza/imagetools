import assert from "node:assert/strict";
import test from "node:test";
import { parseConnectedSsid } from "./wifi-detection.js";

test("estrae l'SSID dall'output netsh italiano", () => {
  const output = `Stato : connessa\r\n    SSID                   : Redmi Note 13 5G\r\n    BSSID                  : aa:bb:cc:dd:ee:ff`;
  assert.equal(parseConnectedSsid(output), "Redmi Note 13 5G");
});

test("non confonde BSSID e restituisce null senza connessione", () => {
  assert.equal(parseConnectedSsid("Stato : disconnessa\r\nBSSID : aa:bb"), null);
});
