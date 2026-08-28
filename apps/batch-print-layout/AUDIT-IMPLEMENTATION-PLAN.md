# Batch Print Layout — audit e piano di implementazione

## Obiettivo e metodo

Rendere Batch Print Layout affidabile per lavori di stampa reali, mantenendo la compatibilità con FileX Suite e senza attribuire al software capacità non verificate.

Fonti di verità usate:

- codice e test del repository;
- `AGENTS.md`, `apps/filex-desktop/AGENTS.md` e `docs/GIT_WORKFLOW.md`;
- manifest `apps/filex-desktop/src/tool-manifest.ts` e contratti `@photo-tools/desktop-contracts`;
- osservazione dell'app desktop a 1526×973;
- dimensioni ufficiali Polaroid: [support.polaroid.com](https://support.polaroid.com/hc/en-us/articles/115012363647-What-are-Polaroid-photo-dimensions) e [polaroid.com](https://www.polaroid.com/en_gb/products/polaroid-go-film-variety-pack).

Le fonti ufficiali confermano 53,9×66,6 mm per il supporto Polaroid Go e 47×46 mm per l'immagine. Non specificano nella pagina testuale la posizione verticale esatta dell'area immagine: l'offset superiore resta quindi un parametro di preset documentato e testabile, non viene presentato come misura ufficiale.

## Architettura rilevata prima dell'intervento

1. `App.tsx` (oltre 1.400 righe): stato React, import, editor esterno, crop, scorciatoie, anteprima ed export.
2. `print-engine.ts`: misure, preset, scelta della griglia, crop iniziale e paginazione.
3. `render-export.ts`: compositing Canvas, logo, codifica JPG/PNG/TIF/PDF, ZIP e scrittura desktop.
4. `filex-desktop`: selezione cartella, scansione file, preview native e scrittura output tramite IPC condiviso.

Problema architetturale iniziale: anteprima ed export usavano lo stesso renderer alla risoluzione di stampa; `App.tsx` includeva inoltre un intero pannello crop nascosto dal CSS ma ancora montato nel codice. Entrambi i difetti sono stati rimossi durante l'implementazione.

## Architettura target

- **Dominio puro**: preset fisici, geometria della cornice, crop, griglia, paginazione e stime memoria senza dipendenze DOM.
- **Import**: lettura desktop/browser resiliente per file, diagnostica degli scarti e URL lifecycle esplicito.
- **Rendering**: una pipeline comune ma con DPI di anteprima separato dal DPI di esportazione; segni di taglio e cornici derivati dalla geometria fisica.
- **Export**: nomi sicuri, collisioni gestite, metadati DPI e limiti memoria prima di creare canvas molto grandi.
- **UI**: un solo workbench, azioni ordinate secondo il flusso Importa → Formato → Controlla → Esporta, stato accessibile e preset rapido.
- **Bridge FileX Suite**: soltanto estensioni opzionali retrocompatibili ai contratti esistenti; nessun nuovo manifest o canale IPC duplicato.

## Backlog verificato

La colonna “Prova” indica il criterio minimo necessario per considerare concluso l'intervento.

| # | Priorità | Intervento | Evidenza attuale | Prova di completamento |
|---:|:---:|---|---|---|
| 1 | P0 | Formalizzare la geometria fisica delle cornici | Polaroid Go è gestita con condizioni sparse nel renderer | helper puro con rettangolo esterno/interno e test dimensionali |
| 2 | P0 | Applicare realmente la cornice Polaroid Go | prima dell'intervento il preset cambiava solo 53,9×66,6 mm | preview ed export mostrano area 47×46 mm e bordo inferiore |
| 3 | P0 | Correggere l'autorotazione fuorviante | default attivo; foto già orientate tramite EXIF vengono ruotate in base al solo aspect ratio | default disattivo, etichetta esplicita, test |
| 4 | P0 | Correggere il crop dopo rotazioni di 90/270° | le frazioni di crop vengono calcolate sugli assi ruotati ma applicate agli assi originali | test su sorgenti portrait/landscape e rapporto finale corretto |
| 5 | P0 | Esportare dalla miglior sorgente disponibile | il desktop esporta sempre dalla preview JPEG limitata a 2400 px | preview ad alta risoluzione richiesta in base al formato/DPI |
| 6 | P0 | Separare DPI anteprima e DPI export | a 600 DPI ogni movimento rigenera un foglio fino a migliaia di pixel | canvas preview limitato, export invariato |
| 7 | P0 | Supportare HEIC/HEIF e TIFF nella scansione desktop | `native-folder-service` ammette solo JPG/PNG/WebP e RAW | estensione opzionale del contratto e import reale verificato |
| 8 | P0 | Isolare gli errori di import per singolo file | una Promise rigettata interrompe l'intera cartella | file leggibili importati, conteggio errori mostrato |
| 9 | P0 | Rendere visibili gli errori di anteprima | il `catch` del renderer è vuoto | stato UI con nome pagina/errore senza bloccare i controlli |
| 10 | P0 | Sanificare i nomi di export | il prefisso accetta separatori, nomi Windows vietati e `..` | test con input ostili e nome finale sicuro |
| 11 | P0 | Evitare sovrascritture silenziose | `writeFile` sostituisce file omonimi | suffisso progressivo non distruttivo sul desktop |
| 12 | P0 | Impedire canvas oltre il budget | nessuna stima prima di allocare fogli grandi a 600 DPI | stima byte, limite esplicito e messaggio utilizzabile |
| 13 | P1 | Centrare l'ultima pagina incompleta | gli ultimi elementi occupano sempre le prime celle in alto | 1, 2, 3 e 5 elementi centrati con test |
| 14 | P1 | Aggiungere segni di taglio opzionali | cornice bianca su foglio bianco non mostra il bordo esterno | guide stampabili sottili, disattivabili, test geometrico |
| 15 | P1 | Aggiungere preset rapido “Polaroid Go 15×20” | oggi servono più selezioni separate | un'azione imposta formato, foglio, crop e output consigliato |
| 16 | P1 | Non azzerare crop per cambi irrilevanti | cambiare DPI ricrea tutti i crop e perde “controllata” | DPI/foglio preservano crop; solo cambio aspect li ricalcola |
| 17 | P1 | Eliminare stato cornice fantasma nel preset custom | passando a “Personalizzato” può restare `frameStyle` attivo | custom sempre esplicito e coerente |
| 18 | P1 | Gestire foto non controllate prima dell'export | export possibile senza distinguere crop verificati | riepilogo chiaro e conferma locale non distruttiva |
| 19 | P1 | Disabilitare controlli dipendenti | posizione/scala logo attivi anche senza logo; qualità JPG sempre attiva | disabled state e testo contestuale corretti |
| 20 | P1 | Rendere la navigazione pagina comprensibile | frecce senza etichetta accessibile e numero lontano | `aria-label`, pagina corrente accanto alle frecce |
| 21 | P1 | Rendere stato e progressi accessibili | status è testo passivo | `role=status`, `aria-live`, pulsante export con avanzamento |
| 22 | P1 | Correggere il flusso editor esterno | fallback può scegliere un editor non Photoshop ma il pulsante dice Photoshop | nome editor reale o azione disabilitata, errori espliciti |
| 23 | P1 | Rimuovere pannello crop morto e CSS relativo | `.crop-panel { display:none }` ma circa 100 righe JSX restano montate | codice e ref inutili eliminati, build invariata |
| 24 | P1 | Ridurre il costo del drag | ogni movimento ridisegna tutta la pagina e ricarica le immagini | cache decode o rendering limitato, verifica visuale fluida |
| 25 | P2 | Mostrare un riepilogo stampa prima dell'export | misure, orientamento e DPI sono distribuiti in più sezioni | scheda unica con fogli, copie, misure, DPI e output |
| 26 | P2 | Validare numeri e stati vuoti | `Number("")` può introdurre zero/NaN nello stato | normalizzazione e test con NaN, infinito, valori negativi |
| 27 | P2 | Allineare descrizioni dei preset alle funzioni reali | vari preset dichiarano aree immagine senza renderizzare la cornice | etichette “solo ingombro” oppure geometria verificata |
| 28 | P2 | Ampliare la caccia bug raggiungibile dalla Dev Console | 15 test coprono quasi solo griglia/crop | casi import, nomi, memoria, frame, rotazioni e ultima pagina |
| 29 | P2 | Alleggerire il bundle iniziale | PDF, ZIP e TIFF portano il chunk principale oltre 800 kB | import dinamici e nessun warning Vite oltre 500 kB |
| 30 | P2 | Diagnosticare i codec dei formati estesi | un HEIC non decodificabile appare come errore generico | conteggio dedicato e suggerimento codec Windows soltanto quando pertinente |
| 31 | P2 | Allineare le etichette al selettore reale | “foto/cartella” suggerisce due modalità, ma il flusso sceglie una cartella | pulsanti espliciti “Sfoglia cartella” e “Seleziona cartella foto” |

## Esito finale requisito per requisito

| # | Esito | Evidenza verificata |
|---:|:---:|---|
| 1 | Fatto | `POLAROID_GO_GEOMETRY_CM` e `getPhotoContentRectCm`; test su rettangolo fisico canonico. |
| 2 | Fatto | renderer basato sul rettangolo 47 × 46 mm; smoke test visivo con cornice bianca e bordo inferiore. |
| 3 | Fatto | autorotazione disattivata di default, etichetta esplicita e nota EXIF. |
| 4 | Fatto | crop calcolato sugli assi corretti per 90/270°; test portrait/landscape. |
| 5 | Fatto | export desktop richiede una preview per pagina dimensionata ai pixel fisici; sorgenti temporanee rilasciate dopo il render. |
| 6 | Fatto | DPI anteprima limitato da `getPreviewRenderDpi`; DPI export resta quello scelto. |
| 7 | Fatto | contratto opzionale `includeExtendedImages`, policy scanner testata e `getDesktopPreview` verificato su `IMG_0289.HEIC`: JPEG 833×1110, 129.357 byte tramite decoder shell Windows. |
| 8 | Fatto | import browser e desktop isolano gli errori per file; smoke test: 1 immagine importata e 4 file non supportati ignorati senza interrompere il batch. |
| 9 | Fatto | gli errori del renderer aggiornano lo stato UI invece di essere inghiottiti. |
| 10 | Fatto | prefissi e nomi Windows sanificati; test su separatori, `..` e nomi riservati. |
| 11 | Fatto | prima della scrittura desktop viene cercato un nome libero con suffisso progressivo. |
| 12 | Fatto | stima RGBA, limite 512 MiB e limite lato canvas verificati prima dell'allocazione; test dedicati. |
| 13 | Fatto | ultima pagina bilanciata e centrata; test 1/4 elementi e smoke test con una Polaroid al centro. |
| 14 | Fatto | segni di taglio opzionali derivati dagli angoli fisici della card e attivati dal preset rapido. |
| 15 | Fatto | pulsante “Polaroid Go 15×20” verificato a runtime: 5,39×6,66 cm, foglio 15×20, 300 DPI, 3×2, crop cover. |
| 16 | Fatto | la chiave di invalidazione crop esclude DPI e foglio; ricalcolo solo quando cambia la geometria utile. |
| 17 | Fatto | il passaggio a “Personalizzato” azzera esplicitamente `frameStyle`. |
| 18 | Fatto | export con foto non controllate richiede conferma locale senza alterare il progetto se annullata. |
| 19 | Fatto | logo e qualità disabilitano i controlli non applicabili; stato verificato nel DOM accessibile. |
| 20 | Fatto | frecce con `aria-label` e indicatore pagina adiacente, verificati nel DOM. |
| 21 | Fatto | stato `aria-live`, ruolo `status` e testo “Esportazione...” durante il lavoro. |
| 22 | Fatto | azione editor generica, rilevamento Photoshop esplicito e nessun fallback silenzioso a un programma arbitrario. |
| 23 | Fatto | pannello crop nascosto, ref e funzioni drag duplicate rimossi; ricerca statica senza occorrenze residue. |
| 24 | Fatto | anteprima limitata indipendentemente dal DPI di stampa e render temporizzato; smoke test senza warning/errori runtime. |
| 25 | Fatto | riepilogo unico con griglia, orientamento, pagina, formato, DPI, controllate e output. |
| 26 | Fatto | campi numerici ignorano stato vuoto/NaN e applicano min/max; dominio normalizza infinito e negativi con test. |
| 27 | Fatto | preset non implementati dichiarano “solo ingombro”; Polaroid Go è l'unico preset con cornice interna verificata. |
| 28 | Fatto | 22 test dominio/export più 3 test policy desktop; entrambi gli script sono registrati nella FileX Dev Console. |
| 29 | Fatto | `jspdf`, `jszip` e `utif` caricati on demand; chunk principale ridotto da circa 801 kB a 252 kB, warning Vite eliminato ed export runtime PDF/TIFF/ZIP verificati. |
| 30 | Fatto | gli errori di preview HEIC/HEIF/TIFF sono contati separatamente e mostrano il suggerimento codec Windows senza attribuirlo agli altri formati. |
| 31 | Fatto | le due azioni di import indicano ora esplicitamente che aprono una cartella, coerentemente con browser e desktop. |

## Verifiche finali eseguite

- `npm run test:batch-print-layout-bug-hunt`: 22/22 test superati.
- `npm run test:batch-print-layout-desktop-images`: 3/3 test superati.
- typecheck rigoroso Batch Print Layout con `noUnusedLocals` e `noUnusedParameters`: superato.
- typecheck `@photo-tools/filex-desktop`: superato.
- typecheck `@photo-tools/filex-dev-console`: superato.
- build produzione Batch Print Layout: superata, senza warning di chunk oltre 500 kB.
- build integrata `@photo-tools/filex-desktop build:batch-print-layout`: superata.
- smoke test locale a 1280×720: preset, import resiliente, cornice, centratura, stato accessibile e log runtime verificati.
- smoke export sulla build produzione: PDF, TIFF e ZIP multipagina completati senza errori; 14/14 crop controllati su 3 fogli.
- probe Electron/Windows su HEIC reale: decoder shell e servizio FileX verificati; i file temporanei del probe sono stati rimossi. Il binario `sharp` presente non include il codec HEIF, quindi su Windows senza estensioni HEIF/HEVC di sistema l'import deve essere considerato non disponibile e segnalato come file non decodificabile.

## Sequenza di implementazione

1. Mettere in sicurezza dominio e test (#1–4, #13, #26).
2. Correggere pipeline di rendering/export (#5–6, #9–12, #14, #24).
3. Rendere resiliente l'import FileX (#7–8).
4. Correggere flusso e accessibilità UI (#15–23, #25, #27).
5. Estendere la suite “Batch Print Layout — Caccia bug” (#28).
6. Alleggerire il caricamento iniziale (#29).
7. Eseguire test workspace, typecheck con unused checks, build app, build shell e smoke test visuale.

## Fuori ambito senza autorizzazione separata

- release, installer, tag, push e pubblicazione;
- modifica della policy licenze;
- gestione colore/soft proof ICC completa, che richiede una decisione di prodotto e una pipeline colore dedicata.
