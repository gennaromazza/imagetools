# Photo Tools for Photographers

## 01. Tech Stack & Technical Conventions

Questo documento definisce lo stack tecnologico del progetto e le convenzioni tecniche da rispettare durante lo sviluppo.

Il suo scopo e bloccare in anticipo le decisioni strutturali piu importanti, cosi da evitare:

- codice incoerente tra moduli
- accoppiamento errato tra UI, core e integrazione
- tool costruiti con pattern diversi tra loro
- difficolta di manutenzione e scalabilita

Questo file va letto insieme a `docs/00-overview.md` prima di iniziare qualsiasi implementazione.

## 1. Obiettivi tecnici dello stack

Lo stack deve supportare questi requisiti:

- sviluppo modulare
- forte separazione delle responsabilita
- buona tipizzazione
- facilita di manutenzione
- riuso dei moduli tra plugin e strumenti di supporto
- possibilita di testare il core senza dipendere da Photoshop
- serializzazione semplice di preset e configurazioni

## 2. Stack principale confermato

Le tecnologie principali del progetto sono:

- TypeScript
- Node.js
- UXP JavaScript / TypeScript per il plugin Photoshop
- JSON per preset e configurazioni

Scelta strategica:

- Python resta fuori dal primo nucleo del progetto

Python potra essere introdotto in futuro solo per esigenze molto specifiche, ad esempio automazioni esterne, analisi immagini avanzate o tool offline separati. Non deve entrare nel core iniziale del sistema.

## 3. Motivazione delle scelte

### TypeScript

TypeScript e il linguaggio principale del progetto perche offre:

- tipizzazione forte
- migliore manutenzione del codice
- contratti chiari tra moduli
- minori errori nei flussi complessi
- maggiore affidabilita nella collaborazione con agent AI

### Node.js

Node.js viene usato per:

- tooling di sviluppo
- eventuale CLI
- script di supporto
- test
- orchestrazione locale fuori da Photoshop

### UXP per Photoshop

UXP e il layer corretto per la parte plugin Adobe Photoshop.

Va usato per:

- UI del plugin
- chiamate all'ambiente Photoshop
- accesso alle API del pannello/plugin
- esecuzione del renderer finale

### JSON

JSON e il formato base per:

- preset utente
- configurazioni dei tool
- serializzazione dello stato eseguibile
- scambio dati semplice tra moduli

## 4. Stack escluso o rinviato

Per la prima fase del progetto non sono prioritari:

- Python nel core
- database relazionali
- backend remoto
- framework desktop separati
- motori AI interni al prodotto

La prima versione deve restare locale, modulare e snella.

## 5. Architettura tecnica dei package

Il repository deve essere organizzato come monorepo modulare.

```text
apps/
  photoshop-plugin/
  cli/

packages/
  core/
  layout-engine/
  presets/
  shared-types/
  filesystem/
  logging/
```

### `apps/photoshop-plugin`

Responsabilita:

- UI principale del plugin
- orchestrazione dell'esecuzione dal punto di vista utente
- bridge verso Photoshop
- presentazione log, errori, risultati

Non deve contenere:

- algoritmi di layout
- logica complessa di business
- regole di dominio replicate

### `apps/cli`

Responsabilita:

- tool di debug o sviluppo
- test manuali del core
- esecuzione batch fuori dalla UI del plugin

Questo modulo e opzionale nella prima fase, ma la struttura va prevista da subito.

### `packages/core`

Responsabilita:

- orchestrazione dei workflow
- validazioni principali
- logica di business condivisa
- coordinamento tra scanner, engine e renderer

`core` non deve diventare un contenitore generico di utility sparse. Deve restare centrato sui flussi del dominio.

### `packages/layout-engine`

Responsabilita:

- regole di impaginazione
- scelta pattern
- generazione pagine e slot
- algoritmi indipendenti da Photoshop

Vincolo assoluto:

- nessuna dipendenza da API Adobe o da oggetti UXP

### `packages/presets`

Responsabilita:

- definizione schema preset
- caricamento e salvataggio preset
- preset di default dei tool
- normalizzazione configurazioni serializzabili

### `packages/shared-types`

Responsabilita:

- tipi condivisi
- contratti tra moduli
- enum
- interfacce comuni
- error model condiviso

### `packages/filesystem`

Responsabilita:

- lettura cartelle
- raccolta file immagine
- metadata base
- scrittura output
- astrazione degli accessi ai file

Questo package deve tenere separata la logica di accesso ai file dal resto del dominio.

### `packages/logging`

Responsabilita:

- eventi di log
- strutture per warning/error/info
- adattatori per UI, CLI e test

## 6. Separazione tecnica dei layer

La separazione dei layer non e solo architetturale, ma anche di dipendenze.

Regole:

- `apps/photoshop-plugin` puo dipendere da `core`, `shared-types`, `logging`, `presets`
- `core` puo dipendere da `layout-engine`, `filesystem`, `shared-types`, `logging`, `presets`
- `layout-engine` puo dipendere solo da `shared-types` e da utility pure strettamente necessarie
- `filesystem` non deve dipendere da Photoshop
- `shared-types` non deve dipendere da altri package applicativi

Dipendenza vietata:

- `layout-engine -> photoshop-plugin`

## 7. Tecnologie consigliate per implementazione

Le scelte consigliate per la prima base tecnica sono:

- TypeScript come linguaggio in tutti i package possibili
- gestione workspace monorepo con `npm` workspaces
- bundler moderno per il plugin, preferibilmente `Vite` se compatibile con il flusso UXP del progetto
- linting con `ESLint`
- formatting con `Prettier`
- test unitari con `Vitest`

Scelte pragmatiche:

- preferire tool semplici e diffusi
- evitare stack troppo pesanti nella fase iniziale
- introdurre nuove dipendenze solo quando producono un vantaggio chiaro

## 8. Configurazione TypeScript

Linee guida:

- `strict` deve essere abilitato
- evitare `any` salvo casi davvero inevitabili e documentati
- preferire tipi espliciti per input/output di funzioni pubbliche
- esportare contratti condivisi da `shared-types`
- tenere separati i tipi di dominio dai tipi UI

Obiettivo:

- rendere chiaro cosa entra, cosa esce e chi e responsabile di trasformare i dati

## 9. Modello dati di base

I dati devono essere pensati come oggetti serializzabili e stabili.

Categorie principali:

- configurazioni tool
- preset
- metadata immagini
- risultati del layout engine
- job di rendering
- eventi di log

Esempi di entita che il progetto dovra avere:

- `ImageAsset`
- `ImageOrientation`
- `LayoutPattern`
- `LayoutSlot`
- `LayoutPage`
- `ToolPreset`
- `ExportOptions`
- `ToolRunResult`

Le strutture dati comuni vanno definite in `packages/shared-types`.

## 10. Preset e configurazioni

Preset e configurazioni devono essere:

- serializzabili in JSON
- validabili
- indipendenti dalla UI
- versionabili nel tempo

Regole:

- la UI non deve inventare struttura dati locale non documentata
- il preset deve rappresentare lo stato del tool in forma pulita
- il core deve poter eseguire un tool partendo da una configurazione gia validata

Direzione consigliata:

- ogni tool ha un proprio schema configurazione
- i preset di default vivono in `packages/presets`
- eventuali migrazioni future di formato vanno gestite in modo esplicito

## 11. Convenzioni di naming

Convenzioni consigliate:

- file TypeScript: `kebab-case.ts`
- componenti UI: `PascalCase.tsx`
- tipi e interfacce pubbliche: `PascalCase`
- funzioni: `camelCase`
- costanti: `UPPER_SNAKE_CASE` solo quando davvero costanti globali
- chiavi JSON: `camelCase`

Naming da evitare:

- abbreviazioni poco leggibili
- nomi generici come `utils`, `helpers`, `misc`
- componenti con responsabilita multiple

## 12. Convenzioni di codice

Regole generali:

- preferire funzioni piccole e leggibili
- evitare moduli troppo grandi
- mantenere le funzioni pure dove possibile
- isolare gli effetti collaterali nei layer di integrazione
- scrivere codice esplicito piu che "magico"

Per il progetto questo e particolarmente importante:

- il layout engine deve essere deterministico
- i risultati devono essere riproducibili a parita di input
- la logica deve essere facile da testare con dataset reali

## 13. Gestione errori

La gestione errori deve essere strutturata, non improvvisata.

Tipi di errore da distinguere:

- errori di input utente
- errori di validazione
- errori filesystem
- errori Photoshop/UXP
- errori interni del motore

Direzione tecnica:

- il core restituisce errori di dominio comprensibili
- la UI traduce gli errori in messaggi leggibili
- il logging conserva dettaglio tecnico per debug

Da evitare:

- `throw new Error("generic error")` come unica strategia
- messaggi opachi o dipendenti dall'implementazione

## 14. Logging e osservabilita

Ogni esecuzione di un tool dovrebbe generare eventi di log strutturati.

Livelli minimi:

- info
- warning
- error
- success

Il log deve poter essere consumato da:

- UI plugin
- CLI
- test

Obiettivo:

- capire velocemente cosa e successo durante una run
- facilitare debug e supporto

## 15. Testing

La strategia di test deve concentrarsi soprattutto sui moduli indipendenti.

Priorita test:

1. `layout-engine`
2. `core`
3. `filesystem` con casi controllati
4. integrazioni plugin selezionate

Tipologie di test consigliate:

- unit test per funzioni pure
- test di scenario per sequenze di layout
- test su fixture reali per mix verticali/orizzontali

Il renderer Photoshop potra richiedere piu test manuali o di integrazione guidata rispetto al core.

## 16. Strategia per il primo tool

Per `Auto Layout` la priorita tecnica e:

1. modellare bene i tipi condivisi
2. costruire scanner immagini
3. costruire layout engine indipendente
4. definire i payload di rendering
5. integrare il renderer Photoshop
6. costruire la UI sopra contratti gia stabili

Questo ordine evita che la UI guidi male l'architettura.

## 17. Build system

Il sistema di build deve essere semplice da mantenere.

Linee guida:

- build separate per plugin e package condivisi
- script chiari in `package.json`
- output prevedibili
- nessuna logica di build nascosta in script opachi

Script minimi attesi in futuro:

- `dev`
- `build`
- `test`
- `lint`
- `format`
- `typecheck`

## 18. Compatibilita con Photoshop

Il progetto dovra considerare i limiti dell'ambiente UXP e delle API Adobe.

Regola pratica:

- tutta la logica che puo vivere fuori da Photoshop deve vivere fuori da Photoshop

Photoshop va usato per:

- creazione documenti
- piazzamento asset
- trasformazioni finali
- export finale

Non va usato come contenitore del motore decisionale.

## 19. Regole per agent AI e Codex

Quando si genera codice per questo progetto:

- usare TypeScript come default
- non introdurre Python nel core iniziale
- rispettare la separazione tra `apps/` e `packages/`
- non mettere logica di dominio dentro componenti UI
- definire prima i tipi condivisi quando un contratto e ambiguo
- preferire moduli piccoli e ben nominati

Prima di implementare un tool nuovo:

1. leggere `docs/00-overview.md`
2. leggere questo file
3. leggere `docs/02-ui-system.md` quando disponibile
4. leggere il file del tool in `docs/tools/`

## 20. Decisioni gia fissate

Le seguenti decisioni sono da considerare approvate, salvo revisione esplicita:

- linguaggio principale: TypeScript
- runtime di supporto: Node.js
- integrazione Photoshop: UXP
- preset/config: JSON
- architettura: monorepo modulare
- logica di layout separata dal renderer Photoshop
- Python escluso dal primo nucleo

## 21. Prossimo documento da produrre

Dopo questo file, il prossimo documento da creare e:

`docs/02-ui-system.md`

Quel file dovra definire:

- struttura dell'interfaccia
- pattern dei pannelli
- componenti riutilizzabili
- comportamento dei form
- log, progress e feedback utente
- coerenza visiva tra tool
