# Font di Album Flow

L'editor di testo di Album Flow usa **solo font open source** con licenza **SIL Open Font License 1.1** (testo in `OFL-1.1.txt`).
La licenza consente l'uso libero, anche commerciale, la redistribuzione con l'app e l'incorporamento nei file esportati (SVG/JPG, PDF);
vieta soltanto di vendere i font da soli e di riutilizzare il loro nome riservato per versioni modificate.

I file sono i sottoinsiemi *latin* in formato WOFF2 distribuiti dal progetto Fontsource (https://fontsource.org), che li ricava dai
repository originali di Google Fonts. Il sottoinsieme latin comprende le lettere accentate dell'italiano.

| Famiglia | Pesi | Corsivo | Uso consigliato |
| --- | --- | --- | --- |
| Bodoni Moda | 400, 700 | sì | Testate e titoli di moda |
| Playfair Display | 400, 700 | sì | Titoli e citazioni |
| Abril Fatface | 400 | no | Titolo nero e imponente |
| DM Serif Display | 400 | sì | Titoli morbidi |
| Cormorant Garamond | 400, 700 | sì | Corpo del testo |
| Libre Baskerville | 400, 700 | sì | Paragrafi lunghi |
| Italiana | 400 | no | Capitali sottili |
| Cinzel | 400, 700 | no | Capitali romane, numeri di pagina |
| Jost | 300, 400, 600 | no | Sottotitoli e didascalie |
| Tenor Sans | 400 | no | Sans sobrio |
| Montserrat | 400, 700 | no | Testi brevi moderni |
| Inter | 400, 700 | no | Testi piccoli |
| Bebas Neue | 400 | no | Titoli compatti |
| Pinyon Script | 400 | no | Firme e dediche |
| Great Vibes | 400 | no | Calligrafia morbida |

## Come aggiungere un font

1. Verifica che la licenza sia SIL OFL 1.1 (o equivalente libera) sul repository originale del font.
2. Scarica i file WOFF2 *latin* con il nome `<id>-<peso a tre cifre>-<normal|italic>.woff2` (per esempio `bodoni-moda-400-italic.woff2`).
3. Aggiungi la famiglia in `src/model/typography.ts` e una riga in questa tabella.
4. Esegui `npm run test:album-flow-design`: il test controlla che ogni peso dichiarato abbia il suo file, che non ci siano file orfani e
   che la famiglia sia elencata qui.

I diritti d'autore dei singoli font appartengono ai rispettivi autori, indicati nei repository originali; vanno mantenuti se si
ridistribuiscono i file separatamente.
