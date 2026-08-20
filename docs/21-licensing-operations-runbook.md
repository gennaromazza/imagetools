# FileX licensing — runbook operativo

## Relazione con il Modello architetturale dei Tool
Le regole di licensing descritte in questo documento operano in base alla configurazione della proprietà `licenseRuntime` all'interno del manifesto del desktop (`tool-manifest.ts`). Per i dettagli sulla configurazione lato sorgente e sulla creazione di un nuovo pacchetto soggetto o meno a queste licenze, fare riferimento al **[Runbook Creazione e Rilascio di un Nuovo Tool (22-new-tool-creation-runbook.md)](./22-new-tool-creation-runbook.md)**.

## Stato sicuro pre-lancio

- `FILEX_LICENSE_ENFORCEMENT` assente o `observe`: nessun tool viene bloccato.
- `FILEX_ALLOWED_VARIANT_IDS` assente: i webhook commerciali rispondono 503 e non creano abbonamenti.
- `LEMONSQUEEZY_WEBHOOK_SECRET` assente: il webhook risponde 503.
- i pulsanti acquisto puntano alla sezione prezzi finche' non vengono configurati gli URL checkout.
- storefront ufficiale: `https://xsuite.lemonsqueezy.com/`; portale cliente: `https://xsuite.lemonsqueezy.com/billing`.

## Attività pianificata: audit enforcement per tutti i tool

Questo audit va gestito come task separato prima della prossima release commerciale. Non è considerato risolto dalla licenza automatica delle build di sviluppo.

Ambito minimo:

1. Inventariare ogni voce di `tool-manifest.ts` e confermare con il proprietario del prodotto se la policy corretta è `shared-runtime`, `standalone` o `management`.
2. Verificare l'entry point Electron effettivamente contenuto in ciascun installer, evitando controlli presenti soltanto nella Suite o nel renderer web.
3. Installare ogni artefatto e provarlo con stati `unlicensed`, `active`, `grace`, `expired` e `revoked` secondo la policy dichiarata.
4. Eseguire disinstallazione e reinstallazione, verificando che non restino bypass di sviluppo o stati locali incoerenti.
5. Decidere esplicitamente se la disinstallazione debba liberare lo slot dispositivo. Se prevista, la chiamata deve essere best-effort e la rimozione locale deve riuscire anche offline.
6. Automatizzare la matrice nel gate di release e produrre un report per componente.

Quest'attività deve anche risolvere l'ambiguità attuale dei tool `standalone`: il manifest consente l'avvio senza controllo centrale, mentre ogni eventuale entitlement autonomo deve essere verificato nel relativo processo Electron e documentato per prodotto.

## Secret

