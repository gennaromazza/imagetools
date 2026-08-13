# UX, wireframe e linguaggio

## Navigazione

La sidebar usa cinque voci: Protezione, Differenze, Cronologia, Cataloghi Lightroom e Impostazioni. Le funzioni tecniche avanzate restano progressive disclosure.

## Protezione

```text
+-----------------------------------------------------------+
| Archivio principale                       PROTETTO         |
| D:\ARCHIVIO_FOTO · Fonte di verita'                        |
|                              |                            |
|                              v                            |
| Clone esterno                             COLLEGATO        |
| E:\ARCHIVIO_FOTO · Ultima verifica 2 giorni fa             |
|                                                           |
|                 [ Controlla archivio ]                    |
+-----------------------------------------------------------+
```

Il master usa sempre l'etichetta `Fonte di verita'` e non mostra azioni che possano cambiarne il contenuto, salvo l'importazione guidata di nuovi elementi dal clone.

## Piano differenze

```text
32 file da aggiungere al clone             84,2 GB
 4 nuovi file da importare nel principale   6,1 GB
 1 cartella da eliminare dal clone          9,4 GB
 0 conflitti

[Apri dettagli]       [Rendi il clone uguale al principale]
```

Le cancellazioni non sono mai nascoste dentro il totale. Prima dell'esecuzione devono mostrare nome, percorso, quantita', dimensione e recuperabilita'.

## Cronologia

Filtri: Tutto, Copiati, Importati, Aggiornati, Cancellati, Lightroom, Conflitti, Errori. Ricerca per cliente, percorso, file, data e clone.

Ogni sessione mostra un riepilogo narrativo e consente di aprire il dettaglio delle singole operazioni. Un elemento ancora nel cestino presenta `Recupera in una cartella separata` come opzione piu' sicura.

## Stati e messaggi

| Stato tecnico | Copy UI |
|---|---|
| clone missing | Collega il clone associato |
| scan running | Sto controllando l'archivio |
| no differences | Il clone e' gia' uguale al principale |
| verified | Archivio protetto e verificato |
| Lightroom locked | Chiudi Lightroom per proteggere il catalogo |
| conflict | Serve una tua scelta; nessun file e' stato sostituito |
| interrupted | Operazione interrotta; riprenderemo dal punto sicuro |

Evitare `hash mismatch`, `delta`, `mirror`, `transaction rollback` e codici errore nella vista principale. Il dettaglio tecnico resta disponibile per assistenza.

## Accessibilita'

Stati mai comunicati solo tramite colore; focus visibile; target minimi 40 px; contrasto WCAG AA; navigazione tastiera; progresso espresso anche con conteggi e testo; conferme distruttive leggibili senza scroll nascosto.

