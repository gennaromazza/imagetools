# FileX licensing — runbook operativo

## Relazione con il Modello architetturale dei Tool
Le regole di licensing descritte in questo documento operano in base alla configurazione della proprietà `licenseRuntime` all'interno del manifesto del desktop (`tool-manifest.ts`). Per i dettagli sulla configurazione lato sorgente e sulla creazione di un nuovo pacchetto soggetto o meno a queste licenze, fare riferimento al **[Runbook Creazione e Rilascio di un Nuovo Tool (22-new-tool-creation-runbook.md)](./22-new-tool-creation-runbook.md)**.

## Stato sicuro pre-lancio

- `FILEX_LICENSE_ENFORCEMENT` assente o `observe`: nessun tool viene bloccato.
- `FILEX_ALLOWED_VARIANT_IDS` assente: i webhook commerciali rispondono 503 e non creano abbonamenti.
- `LEMONSQUEEZY_WEBHOOK_SECRET` assente: il webhook risponde 503.
- i pulsanti acquisto puntano alla sezione prezzi finche' non vengono configurati gli URL checkout.
- storefront ufficiale: `https://xsuite.lemonsqueezy.com/`; portale cliente: `https://xsuite.lemonsqueezy.com/billing`.

## Secret

