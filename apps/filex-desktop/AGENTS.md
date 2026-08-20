# filex-desktop — shell Electron

La shell gestisce l'avvio desktop, le integrazioni native, il catalogo degli strumenti e gli aggiornamenti. È il workspace `@photo-tools/filex-desktop`.

## Fonti di verità

- Catalogo e metadati dei tool: `src/tool-manifest.ts`.
- Processo principale: `src/main.ts`; launcher della Suite: `src/suite-main.ts`.
- Bridge renderer: `src/preload.ts` e `src/suite-preload.ts`.
- Tipi IPC: `@photo-tools/desktop-contracts`.
- Script di build, sviluppo e packaging: `package.json`.

Non creare un secondo manifest JSON, non ridefinire `DesktopToolId` e non dedurre URL o porte dei tool: alcuni URL di sviluppo sono nel manifest, altri sono definiti dagli script della shell.

## Disciplina di verifica

- Prima di modificare l'avvio di un tool, confronta `tool-manifest.ts`, lo script della shell e il `package.json` del workspace destinatario.
- Non inventare canali IPC: cerca il contratto in `@photo-tools/desktop-contracts` e le chiamate esistenti con `rg`.
- Se una modifica può cambiare packaging, aggiornamenti, licenze o il tool selezionato all'avvio, chiedi conferma quando il requisito non è esplicito.
- Una verifica release delle licenze va eseguita sull'installer, con enforcement reale: prova almeno avvio senza licenza, avvio con licenza attiva e comportamento dopo disinstallazione/reinstallazione. Non usare la licenza automatica delle build dev come evidenza.
- La disinstallazione deve restare disponibile anche con licenza scaduta, revocata o assente. Non introdurre una disattivazione remota obbligatoria che possa impedire la rimozione offline.
- Per contenere token e rischio, ispeziona solo il percorso di avvio e i consumer del tool coinvolto; non rileggere l'intera shell.

## Sviluppo

Gli script `dev:<tool>` compilano la shell e avviano il renderer e, quando previsto, Electron. Avviali dalla radice, ad esempio:

```powershell
npm --workspace @photo-tools/filex-desktop run dev:image-converter
npm --workspace @photo-tools/filex-desktop run dev:photo-selector-app
```

Per un cambiamento limitato, esegui lo script di build o typecheck realmente disponibile nel `package.json`. Packaging e aggiornamenti sono azioni di release e richiedono una richiesta esplicita.
