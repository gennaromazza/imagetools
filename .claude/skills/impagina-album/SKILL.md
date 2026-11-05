---
name: impagina-album
description: Impagina un matrimonio nello stile di Gennaro e consegna il progetto Album Flow (.filex-album.json) da aprire con «Apri progetto…». Usala quando Gennaro dà una cartella di JPG (selezione ritoccata) e chiede l'impaginato, l'album o la prova AI; anche per imparare dalle sue correzioni a un album già consegnato.
---

# Impagina album (stile Gennaro)

Strumento: `tools/album-ai/` (leggi `tools/album-ai/LEGGIMI.md` per formato schede e file). Tutti i comandi si
lanciano da `tools/album-ai/`. I dati del cliente stanno in `tools/album-ai/lavori/<lavoro>/` (esclusa da Git).

## Regole che non si discutono
- Le cartelle delle foto originali sono **sola lettura**: mai scriverci, rinominare o spostare file.
- Non modificare il codice di Album Flow: il risultato è un file progetto, non una modifica all'app.
- Non scrivere versi di canzoni: lo slot `citazione` di `frasi.json` resta vuoto, lo sceglie Gennaro.
- I dev server dell'utente (porte 4175, 3003) non si toccano; l'anteprima usa la configurazione `anteprima-album-ai`.

## Cosa chiedere (solo se manca)
1. Cartella dei JPG (es. `E:\2026\MATRIMONI\<matrimonio>\SELEZIONE`) e, se c'è, l'elenco delle foto da usare
   («Copia nomi» di Image Select Pro). Senza elenco si usano tutti i JPG della cartella.
2. Formato dell'album aperto (es. 80×30 = pagina 40×30). Se è diverso, aggiorna `formato` in `stile-gennaro.json`.
3. Nomi degli sposi e data (per l'apertura), se non si ricavano dalla cartella.

## Procedura
1. **Lavoro**: scegli un nome `<sposo>-<sposa>-AAAA-MM-GG` e salva l'elenco in `lavori/<lavoro>/elenco.txt`
   (con Write: niente heredoc con backslash).
2. **Provini**: `python crea_provini.py --cartella "<cartella>" --elenco lavori/<lavoro>/elenco.txt --uscita lavori/<lavoro>/provini --titolo "<Sposi> — impaginazione"`
   (circa 1-2 minuti per 450 foto: lancialo in background se serve).
3. **Orologi**: con `provini/foto.json` stampa, per fotocamera, prima e ultima foto e cerca le stesse scene riprese
   da macchine diverse (es. lo sposo con la madre da 5D e da 6D). Uno scarto netto e costante (+1 giorno, +1h18…)
   si corregge rilanciando il passo 2 con `--correggi "Modello EXIF=+HH:MM:SS"` o `--correggi "DSCF9001..DSCF9548=-1d"`.
   Controlla anche che il racconto sia logico: lo sposo non può essere vestito prima di vestirsi.
4. **Schede** (unico passo AI, il più costoso): `ALBUM_DATI=<lavoro> python prepara_schede.py`. Poi, per ogni
   `lavori/<lavoro>/vista/vNNN.jpg` (3 provini insieme), guardala e riscrivi il file `schede_parti/pNNN-MMM.txt`
   corrispondente: 9 campi per riga, nessun «?». Attenzione a:
   - `ruolo` preciso: è lui che decide i fogli fissi (dettagli, firme, gruppi all'altare, uscita, torta…);
   - con chi sono gli sposi scritto nell'espressione («sposa con il padre», «la suocera consegna il bouquet»);
   - `simile a NNNN` per i quasi doppioni, `BN` per le foto già in bianco e nero, `DOPO:NOME.jpg` per le foto fuori ordine;
   - i dettagli indossati (sciabola in mano, mani sul cordone) non sono «dettaglio» ma vestizione/ritratto.
   Avvisa Gennaro ogni 2-3 viste a che punto sei.
5. **Frasi**: scrivi `lavori/<lavoro>/frasi.json` copiando la struttura di `frasi-esempio.json`
   (apertura: nomi e data stilizzata; due frasi editoriali sobrie per capitolo; citazione vuota).
6. **Impagina**: `python impagina.py <lavoro>`. Fa schede → simili → motore → anteprime → panoramiche → file Album Flow →
   verifica col controllo di Album Flow. Deve finire con «Violazioni: nessuna» e «OK: …».
7. **Controllo a vista**: guarda `lavori/<lavoro>/panoramiche/<lavoro>_1.jpg` e `_2.jpg` (tutte le doppie in piccolo).
   Cerca: ordine cronologico rotto, stessa situazione su due fogli, persone diverse (mamma/papà) mescolate, dettagli
   in mezzo ai ritratti o alla festa, foto con i parenti mancanti, piedi tagliati. Se trovi problemi correggi le schede
   (ruolo, simile a, DOPO:) o il profilo e rilancia il passo 6.
8. **Consegna**: avvia l'anteprima (preview `anteprima-album-ai`, pagina `/<lavoro>/anteprime-stile/album.html`) e dai
   a Gennaro il percorso completo del `.filex-album.json` da aprire con Home → «Apri progetto…». Il disco delle foto deve
   essere collegato.

## Imparare dalle correzioni di Gennaro
Quando ha sistemato l'album in Album Flow:
1. `python leggi_album_app.py` elenca i progetti nella memoria dell'app; poi
   `python leggi_album_app.py <lavoro> "<parte del nome>"` salva `lavori/<lavoro>/finale-gennaro.filex-album.json`.
2. `ALBUM_DATI=<lavoro> python confronta.py`: doppie e foto per capitolo, fogli interi, foto aggiunte/tolte, doppia per doppia.
3. Trasforma le differenze **ricorrenti** in regole: numeri per capitolo (`doppie`, `fotoPerDoppia` in
   `stile-gennaro.json`), fogli fissi (`ricette_ruoli.py`), scelta e taglio dei fogli (`motore_stile.py`). Una
   preferenza vista in un solo album va annotata, non imposta. Rilancia `impagina.py` e confronta di nuovo.
4. Aggiorna la storia delle regole in `LEGGIMI.md` e fai commit dei soli file dello strumento (mai `lavori/`).
