# Album AI — impaginazione automatica nello stile di Gennaro

Strumento di sviluppo (non distribuito con la Suite): dalla selezione JPG di un matrimonio produce un progetto
Album Flow già impaginato (`.filex-album.json`, da aprire con Home → «Apri progetto…»). Non modifica Album Flow,
non scrive mai nelle cartelle delle foto originali. Per usarlo con Claude Code: skill `/impagina-album`.

## Flusso

| Passo | Comando | Chi |
|---|---|---|
| 1. Provini ed EXIF | `python crea_provini.py --cartella <SELEZIONE> --elenco lavori/<lavoro>/elenco.txt --uscita lavori/<lavoro>/provini [--correggi ...]` | script |
| 2. Orologi delle macchine | confronto degli orari tra fotocamere sulle stesse scene; poi di nuovo il passo 1 con `--correggi` | Claude |
| 3. Schede | `ALBUM_DATI=<lavoro> python prepara_schede.py`, poi compilare `lavori/<lavoro>/schede_parti/*.txt` guardando `lavori/<lavoro>/vista/*.jpg` | Claude (unico passo AI) |
| 4. Frasi e apertura | `lavori/<lavoro>/frasi.json` (nomi, data, frasi; i versi di canzoni li sceglie Gennaro) | Claude |
| 5. Impaginazione e file | `python impagina.py <lavoro>` | script |
| 6. Imparare dalle correzioni | `python leggi_album_app.py <lavoro> "<nome progetto>"`, poi `ALBUM_DATI=<lavoro> python confronta.py` | script + Claude |

`<lavoro>` è una cartella in `lavori/` (per esempio `nicola-carla-2026-06-05`): contiene foto, dati e anteprime del
cliente ed è esclusa da Git.

## Formato delle schede (9 campi)

`nome|momento|tipo|espressione|forza|piena|ruolo|soggetto|note`

- **momento**: PSO preparazione sposo, PSA preparazione sposa, USC uscita (di casa o dalla chiesa), CER cerimonia,
  COP ritratti di coppia, RIC ricevimento, DET dettagli, ALT altro.
- **tipo**: D dettaglio, R ritratto, MB mezzo busto, FI figura intera, G gruppo, A ambiente.
- **espressione**: cosa succede e con chi, con le parole che le ricette riconoscono: «sposo/sposa con la madre»,
  «il padre», «la sorella», «la testimone», «in posa», «brindano»…
- **forza**: da 1 a 5. **piena**: s/n (regge una pagina da sola).
- **ruolo**: dettaglio, vestizione, ritratto, con-parenti (sposi con genitori, fratelli, testimoni: non si tralasciano),
  parenti (senza sposi), gruppo-posa, spontanea, invitati, bouquet-suocera, ingresso, rito, dettaglio-chiesa,
  chiesa-intera (grandangolo dal fondo), firme, gruppi-altare (sposi all'altare dopo le firme), uscita-chiesa,
  rinfresco, coppia, ricevimento (arrivo al ristorante), ballo, torta, brindisi, festa.
- **soggetto**: sx, c, dx (dove sta il soggetto: centra il ritaglio).
- **note**: testo libero, più tre parole riservate:
  - `BN`: la foto è già in bianco e nero;
  - `simile a NNNN`: quasi doppione, ne entra una sola;
  - `DOPO:NOME.jpg`: la foto va subito dopo un'altra (scatto fuori ordine, orologio sbagliato).

## Dove sta lo stile

- `stile-gennaro.json`: capitoli (doppie, foto per doppia), quote, ritagli, bianco e nero, regole fisse.
- `ricette_ruoli.py`: i fogli fissi (dettagli + vestizione, chiesa, firme | gruppi, invitati, uscita, rinfresco e
  gruppone, ristorante, torta, brindisi e regali).
- `motore_stile.py`: scelta e impaginazione (cronologia, situazioni intere, cambio di persona, ritagli).
- `stile/modelli.json`: composizioni ricavate dai suoi album (`estrai_modelli.py`).

Storia delle regole: impostate su un matrimonio di prova (2026-11-04/05) e tarate
sull'impaginato finale corretto da Gennaro: 53 doppie; foto per doppia sposo 4, sposa 4,3, chiesa 6, esterne 3,
ristorante 7; metà fogli interi.
