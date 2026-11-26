# Print Flow: ritaglio in serie per ordini di stampa

Stato: **approvata** (2026-11-26) con due aggiunte: formati Polaroid/Instax e logo.

## Perché

Il Print Flow attuale (ex Batch Print Layout) ha un flusso sbagliato e non funziona. Serve uno strumento pratico, veloce e intuitivo per ritagliare decine o centinaia di foto di un ordine nei formati richiesti, con o senza bordino bianco, ed esportarle.

## Obiettivi

- Un ordine contiene più **gruppi**; ogni gruppo ha formato, riempimento, bordo e foto.
- Ritaglio automatico di tutte le foto, correzione a mano solo dove serve.
- Un solo export: una cartella per gruppo, un file per stampa.
- Fluido con 500 foto.

## Non obiettivi (spariscono)

Più foto sullo stesso foglio, carta consigliata, percorso a 5 passi, export PDF/TIF/PNG/ZIP, bianco e nero, segni di taglio, editor esterno, stampa diretta.

## Come si usa

```text
┌ Gruppi ───────────────┬ 10×15 · pieno formato · 150 foto ───────┐
│ ● 10×15 pieno     150 │ Formato [10×15▾]  Foto [Riempi▾]        │
│ ○ 13×18 bordo 5mm  20 │ Bordo bianco [0] mm                     │
│ + nuovo gruppo        ├─────────────────────────────────────────┤
│                       │ [▣][▣][▣][▣][▣][▣]   (anteprima = file) │
│ [Esporta ordine]      │ [▣][▣][▣][▣][▣][▣]                      │
└───────────────────────┴─────────────────────────────────────────┘
```

- **Aggiunta foto:** cartella, file o trascinamento, nel gruppo selezionato. Si possono spostare o aggiungere anche a un altro gruppo (la stessa foto può stare in due formati, con ritagli indipendenti).
- **Formati:** 10×15, 13×18, 15×20, 20×30, A4, misura libera in cm e i formati Polaroid, Instax e Hi-Print di oggi, con la loro cornice. Nei formati con cornice il bordino è disattivato e l'orientamento è quello della pellicola.
- **Logo:** un'immagine per l'ordine (posizione, grandezza, opacità, margine), attivabile gruppo per gruppo.
- **Riempi:** la foto copre tutta l'area e viene ritagliata. **Foto intera:** niente ritaglio, il resto è bianco.
- **Bordo bianco:** in mm, uguale sui quattro lati, dentro il formato (il file resta della misura esatta). 0 = senza bordo.
- **Orientamento:** il formato segue la foto (verticale o orizzontale), in automatico.
- **Controllo:** clic su una foto per spostare il taglio, zoomare, ruotare di 90°; frecce per passare alla successiva, «Ripristina» per tornare all'automatico.
- **Copie:** numero per foto, predefinito 1.
- **Avviso risoluzione:** segnale sulle foto che in quel formato scendono sotto 200 DPI.
- **Ordine salvato in automatico:** chiudendo e riaprendo si ritrovano gruppi e ritagli. Le foto mancanti sono segnalate, non rimosse in silenzio. «Nuovo ordine» azzera (con conferma).

## Ordine cliente o lavoro veloce (aggiunta del 2026-11-26)

- All'avvio si sceglie: **Ordine cliente** (nome) o **Lavoro veloce**.
- Con un cliente, dentro la destinazione scelta nasce `Nome - AAAA-MM-GG` (data di creazione dell'ordine) con le cartelle dei formati; senza, i formati vanno direttamente nella destinazione.
- Aspetto allineato alla Suite: tema scuro, accento oro, verde dell'icona.

## Export

- Si sceglie una cartella; dentro nasce una sottocartella per gruppo, per esempio `10x15` e `13x18_bordo5mm`.
- JPG qualità alta, 300 DPI scritti nel file, colore sRGB, dai file originali e non dalle anteprime.
- Nome originale; le copie diventano `nome_copia2.jpg`. Nessuna sovrascrittura, mai: se la sottocartella esiste si riusa, e i nomi già presenti ricevono un suffisso (`nome-2.jpg`), come per due foto omonime di cartelle diverse. Gli originali non si toccano.
- Qualità JPG 95. In ingresso gli stessi formati accettati oggi da Print Flow.
- Una foto alla volta in memoria, avanzamento visibile, annullabile.
- La scrittura è atomica **per gruppo**: se un gruppo fallisce, quelli già finiti restano, il riepilogo dice quali mancano e si riprova solo quelli.

## Approcci considerati

1. **Interfaccia e logica nuove dentro il pacchetto attuale (scelto).** Restano nome, icona, ID `batch-print-layout`, aggiornamenti, licenza, sito. Contro: restano due moduli vecchi che usa ID Photo.
2. **Programma separato con ID nuovo.** Più pulito, ma rifà collegamenti Suite, licenza, release e sito e lascia il vecchio installato agli utenti.
3. **Correggere il percorso attuale.** Scartato: il problema è il flusso.

## Struttura (`apps/batch-print-layout`, versione 0.3.0)

| Modulo | Compito | Test |
|---|---|---|
| `src/order/model.ts` | Ordine, gruppi, foto, copie; operazioni pure | sì |
| `src/order/geometry.ts` | Area stampabile, orientamento, ritaglio, DPI effettivi | sì |
| `src/order/naming.ts` | Nomi di cartelle e file, collisioni | sì |
| `src/order/storage.ts` | Salvataggio e riapertura dell'ordine | sì |
| `src/order/render.ts` | Canvas di una stampa; anteprima e export usano la stessa geometria | sì |
| `src/order/export.ts` | Coda di export per gruppo | sì |
| `src/ui/*` | Gruppi, griglia, ritaglio, export | prova a schermo |

- `print-engine.ts` e `render-export.ts` **restano invariati**: li usa ID Photo. Print Flow ne riusa la scrittura JPG con DPI e la transazione atomica.
- Si cancellano planner, passi, anteprima foglio, `useWorkbench`, copie vecchie e documenti collegati; `ARCHITETTURA.md` si riscrive.
- **Novità nel processo principale:** oggi la scrittura atomica accetta solo nomi di file in una cartella già esistente. Serve una funzione per creare la sottocartella del gruppo, dichiarata in `@photo-tools/desktop-contracts`, che rifiuta percorsi fuori dalla cartella scelta.
- Resta l'arrivo di foto da Archivio Flow (massimo 500): finiscono nel gruppo selezionato.
- Nell'elenco di Archivio Flow l'etichetta «Batch Layout» diventa «Print Flow».
- Test raggiungibili dalla Dev Console; sito e changelog aggiornati. La release si fa solo su richiesta.

## Metodo di lavoro (richiesto)

1. Claude scrive piano e contratti di ogni modulo (tipi, firme, regole, casi limite).
2. Gemini 3.1 Pro (anteprima), via OmniRoute, scrive il codice un modulo alla volta.
3. Claude legge il codice, corregge i bug, poi scrive i test e li esegue.
4. Cancello finale: typecheck, test di Print Flow e ID Photo, revisione del diff, prova nell'app.

A Gemini vanno solo contratti ed estratti di codice necessari: mai segreti, dati di clienti o percorsi privati. Se un modulo torna sbagliato due volte, lo scrive Claude e lo dichiara.

La risposta di Gemini va su file senza essere ricopiata da Claude (comando `omniroute chat`). Il risparmio di token non è garantito: dipende da quante correzioni servono.
