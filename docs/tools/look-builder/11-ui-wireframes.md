# Wireframe e stati UI

Questi wireframe verificano gerarchia, informazioni e transizioni. Non definiscono stile visivo, colori, font o dimensioni definitive.

## Struttura persistente

```text
+--------------------------------------------------------------------------------+
| FileX Look Builder        Progetto: Editorial Warm       Stato: salvato         |
+----------------------+---------------------------------------------------------+
| 1 Reference          |                                                         |
| 2 Foto di prova      |                 area dello step                         |
| 3 Base tecnica       |                                                         |
| 4 Proposte           |                                                         |
| 5 Confronto A/B      |                                                         |
| 6 Validazione        |                                                         |
| 7 Esporta            |                                                         |
|                      |---------------------------------------------------------|
| Audit                | Indietro                         Continua / azione primaria|
+----------------------+---------------------------------------------------------+
```

Lo stepper distingue completato, corrente, da verificare e bloccato. `Audit` e' sempre raggiungibile ma non compete con l'azione primaria.

## 1. Import

```text
+---------------------------------------------------------------+
| Costruiamo il tuo look                                        |
|                                                               |
| ( ) Esplora        ( ) Da reference       ( ) Il mio stile    |
|     proposte           foto che ami           RAW + finali    |
|                                                               |
| Reference                                                    |
| +-----------------------------------------------------------+ |
| | Trascina RAW o JPEG oppure [Scegli file]                  | |
| | I file originali verranno aperti in sola lettura.         | |
| +-----------------------------------------------------------+ |
|                                                               |
| 12 file pronti  |  2 da verificare  |  [Mostra dettagli]     |
|                                               [Analizza]       |
+---------------------------------------------------------------+
```

Stati necessari:

- vuoto con spiegazione delle tre modalita';
- drag attivo;
- probe in corso per singolo file;
- file duplicato;
- formato non supportato;
- limite raggiunto prima dell'import;
- cartella/file non leggibile;
- modalita' paired con RAW e JPEG non associati.

## 2. Qualita' delle reference

```text
+--------------------------------------------------------------------------------+
| Qualita' delle reference                     Coerenza complessiva: Buona         |
|--------------------------------------------------------------------------------|
| [thumb] IMG_01.RAF   Fuji X-T5   RAW lineare        OK                          |
| [thumb] IMG_02.JPG   sRGB        JPEG               OK                          |
| [thumb] IMG_03.JPG   ICC assente, assunto sRGB      [Da verificare]             |
| [thumb] IMG_04.JPG   Look molto diverso dal gruppo  [Outlier] [Escludi]          |
|--------------------------------------------------------------------------------|
| Il gruppo suggerisce: contrasto morbido, alte luci calde, verdi attenuati.       |
| Due file possono rendere il risultato meno stabile.                             |
| [Vedi come viene analizzato]                      [Conferma reference]           |
+--------------------------------------------------------------------------------+
```

Ogni warning deve spiegare conseguenza e azione. Il punteggio non deve sembrare un giudizio sulla fotografia.

## 3. Base tecnica

```text
+--------------------------------------------------------------------------------+
| Scegli il punto di partenza                                                     |
|--------------------------------------------------------------------------------|
| [ Nessuna base ]     [ Base suggerita ]       [ Auto Tone in Lightroom ]        |
|                       raccomandata                                              |
|--------------------------------------------------------------------------------|
|                    immagine sincronizzata                                      |
|            [Prima]  |  [Dopo]       clipping: [ ]                              |
|--------------------------------------------------------------------------------|
| Istogramma prima/dopo      Ombre: preservate   Alte luci: attenzione             |
| La scena sembra high-key: non abbiamo forzato il punto nero.                    |
| [Dettagli tecnici]                                      [Conferma base]         |
+--------------------------------------------------------------------------------+
```

La UI non mostra “istogramma corretto”. Spiega invece cosa e' stato preservato, modificato o lasciato incerto.

## 4. Proposte iniziali

```text
+--------------------------------------------------------------------------------+
| Quattro direzioni per il tuo look                                               |
|--------------------------------------------------------------------------------|
| [A preview]          [B preview]          [C preview]          [D preview]       |
| Editorial Warm       Clean Neutral        Soft Film            Cool Modern      |
| pelle prioritaria    neutri fedeli        neri sollevati       blu controllati   |
| [Scegli]             [Scegli]             [Scegli]             [Scegli]          |
|--------------------------------------------------------------------------------|
| Foto:  <  3 / 8  >       Intensita' preview: Standard                           |
| Nessuna proposta copia preset di terzi.                                         |
+--------------------------------------------------------------------------------+
```

Le etichette descrivono attributi osservabili. Evitare nomi che promettono un genere fotografico completo o imitano marchi/pellicole senza autorizzazione.

## 5. Confronto A/B

```text
+--------------------------------------------------------------------------------+
| Quale preferisci per le alte luci?                  Passaggio 4 di 9             |
|--------------------------------------------------------------------------------|
| [                 A                 ] | [                 B                 ]    |
|       piu' morbide e calde           |       piu' pulite e neutrali              |
|--------------------------------------------------------------------------------|
| [Preferisco A]    [Nessuna differenza]    [Preferisco B]    [Salta]              |
|--------------------------------------------------------------------------------|
| Stiamo regolando: roll-off e temperatura percepita delle alte luci.              |
| Non stiamo cambiando: pelle e risposta dei verdi.                                |
| [Perche' questa domanda?]                                                        |
+--------------------------------------------------------------------------------+
```

Stati necessari:

- caricamento sincronizzato delle due preview;
- una preview fallita;
- differenza troppo piccola;
- utente incoerente su confronti equivalenti, mostrato senza giudizio;
- annulla/ripristina decisione;
- livello di zoom e foto sincronizzati.

## 6. Griglia di validazione

```text
+--------------------------------------------------------------------------------+
| Verifica il look su foto diverse                    Confidenza: buona            |
|--------------------------------------------------------------------------------|
|                 Soft                 Standard                 Strong             |
| Ritratto       [preview]              [preview]               [preview]          |
| Esterno        [preview]              [preview]               [preview]          |
| Interno        [preview !]            [preview !]             [preview !!]       |
| Notte          [preview]              [preview]               [preview !]        |
|--------------------------------------------------------------------------------|
| 3 avvisi: pelle sotto LED, rosso vicino al clipping, reference senza ICC.        |
| [Apri avvisi] [Cambia foto di verifica] [Torna al look] [Approva Standard]       |
+--------------------------------------------------------------------------------+
```

La validazione distingue foto usate nel fitting e holdout. L'utente non puo' ricevere una confidenza alta se tutte le prove erano reference.

## 7. Pannello Audit

```text
+--------------------------------------------------------------------------------+
| Audit del look                                                       [Esporta]  |
|--------------------------------------------------------------------------------|
| Input | Pipeline | Tono | Colore | Look | LUT QA | Export | Log                 |
|--------------------------------------------------------------------------------|
| RAW decode        completato   2,4 s   LibRaw x.y   RAF X-Trans                 |
| Canonical image   completato   0,3 s   working space: ...                       |
| Base tecnica      warning      TON_HIGH_KEY_PRESERVED                            |
| Look fit          completato   0,8 s   algoritmo look-fit@1                      |
| LUT validation    completato           no inversioni / clipping entro soglia    |
|--------------------------------------------------------------------------------|
| [Confronta gli stage] [Copia dettagli redatti] [Crea bundle diagnostico]         |
+--------------------------------------------------------------------------------+
```

La vista predefinita usa linguaggio fotografico; dettagli numerici e log restano progressivamente accessibili.

## Errori e warning

```text
+---------------------------------------------------------------+
| Reference da verificare                                       |
|                                                               |
| Il JPEG non contiene un profilo colore.                       |
| Per l'anteprima verra' assunto sRGB. Il colore potrebbe       |
| differire dall'applicazione in cui e' stato esportato.         |
|                                                               |
| Codice: JPEG_UNTAGGED_ASSUMED_SRGB                            |
| [Escludi file] [Continua con sRGB] [Apri dettagli]             |
+---------------------------------------------------------------+
```

Classi visive e comportamentali:

- **Informazione**: non richiede scelta;
- **Da verificare**: richiede comprensione, puo' continuare;
- **Problema**: richiede azione prima dello step successivo;
- **Errore tecnico**: operazione fallita, originali integri, recovery disponibile.

Ogni errore deve indicare: cosa e' successo, effetto sul risultato, integrita' degli originali, azione consigliata e codice Audit.

## 8. Esportazione finale

```text
+--------------------------------------------------------------------------------+
| Il tuo look e' pronto                                                           |
|--------------------------------------------------------------------------------|
| Nome: FileX Editorial Warm                                                      |
| Profilo creativo: incluso                                                       |
| Preset: Look only, Soft, Standard, Strong                                       |
| Auto Base: [incluso / non incluso secondo decisione]                            |
| Compatibilita' verificata: Lightroom Classic ... / Lightroom desktop ...        |
|--------------------------------------------------------------------------------|
| Destinazione: C:\...\FileX-Editorial-Warm.zip          [Cambia]                 |
| [ ] Sovrascrivi una versione esistente                                          |
|--------------------------------------------------------------------------------|
| [Torna alla validazione]                              [Genera pacchetto ZIP]     |
+--------------------------------------------------------------------------------+
```

Stati export:

1. riepilogo e conferma;
2. generazione file temporanei;
3. validazione XMP e LUT;
4. costruzione e verifica ZIP;
5. rename atomico nella destinazione;
6. successo con checksum e istruzioni d'import;
7. fallimento recuperabile senza lasciare un ZIP apparentemente valido.

## Responsive e accessibilita'

- definire una larghezza minima desktop per confronti colore affidabili;
- sotto la soglia, preferire confronto alternato sincronizzato allo split troppo stretto;
- supportare tastiera per A/B, zoom, avanti/indietro e annulla;
- non comunicare clipping, warning o scelta soltanto attraverso colori;
- conservare etichette testuali anche quando sono presenti istogrammi e icone;
- verificare contrasto UI senza alterare la colorimetria delle fotografie;
- prevedere modalita' full-screen controllata per la valutazione, mantenendo accessibile lo stato del renderer.

## Test di comprensione prima dello scaffold finale

Il prototipo wireframe deve verificare con fotografi:

- differenza compresa tra base, look, profilo e preset;
- significato di reference e foto di verifica;
- comprensione di warning ICC e renderer;
- capacita' di identificare perche' una proposta e' diversa;
- fiducia correttamente calibrata nella preview rispetto a Lightroom;
- percorso per correggere un outlier;
- capacita' di esportare senza aprire l'Audit tecnico.

