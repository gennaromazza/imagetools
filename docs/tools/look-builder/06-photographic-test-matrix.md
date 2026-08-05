# Matrice dei casi fotografici

Questa matrice guida dataset interno, QA manuale e criteri di fallimento. Le fotografie reali devono essere di proprieta' FileX, commissionate con liberatorie o donate esplicitamente per test. Dataset accademici con licenza research-only non possono diventare automaticamente asset commerciali.

## Regole trasversali

- confrontare `Base`, `Look` e `Base + Look` separatamente;
- verificare Soft, Standard e Strong;
- includere almeno un'immagine non usata nel fitting;
- registrare camera, obiettivo, illuminante, profilo e renderer;
- valutare il risultato sia nel renderer FileX sia in Lightroom;
- non definire un istogramma ideale universale;
- far revisionare la pelle da persone competenti e su soggetti diversi.

## Ingest e profili

| ID | Caso | Risultato atteso | Fallimento da segnalare |
|---|---|---|---|
| ING-01 | Fuji RAF X-Trans supportato | Decode lineare e preview embedded chiaramente distinte | Preview embedded usata come RAW analitico |
| ING-02 | RAF di modello nuovo | Capability check e fallback esplicito | Colori plausibili ma decoder errato non dichiarato |
| ING-03 | CR3/NEF/ARW supportati | Contratto canonical identico, provenance specifica | Logica camera dentro il core del look |
| ING-04 | DNG nativo e convertito | Origine e profilo riconosciuti | DNG trattati tutti come equivalenti |
| ING-05 | JPEG sRGB | ICC rispettato | Assunzione diversa dal profilo incorporato |
| ING-06 | JPEG Adobe RGB/P3 | Conversione color-managed | Saturazione/toni alterati per interpretazione sRGB |
| ING-07 | JPEG senza ICC | Assunzione sRGB visibile e auditabile | Assunzione silenziosa |
| ING-08 | JPEG gia' clippato | Warning e nessuna falsa ricostruzione | Recupero inventato o artefatti |
| ING-09 | RAW/JPEG corrotti | Errore isolato, progetto utilizzabile | Crash del processo UI |
| ING-10 | Monocromatico | Stato mono conservato o incompatibilita' chiara | Dominanti colorate introdotte |

## Tono ed esposizione

| ID | Caso | Risultato atteso | Fallimento da segnalare |
|---|---|---|---|
| TON-01 | High-key intenzionale | Bianchi ariosi preservati | Stretch verso neri pieni |
| TON-02 | Low-key intenzionale | Ombre profonde preservate | Sollevamento automatico distruttivo |
| TON-03 | Nebbia | Contrasto locale non inventato senza consenso | “Correzione” che elimina l'atmosfera |
| TON-04 | Silhouette | Soggetto non schiarito automaticamente | Recupero ombre contro intenzione |
| TON-05 | Controluce | Highlight roll-off regolare | Halo, solarizzazione o volto grigio |
| TON-06 | Speculari | Speculari distinti dal clipping esteso | Compressione globale per pochi pixel |
| TON-07 | Sottoesposto ad alti ISO | Base conservativa e warning rumore | Amplificazione forte di rumore e crominanza |
| TON-08 | Mezzitoni troppo alti | Riduzione moderata con confronto A/B | Curva non monotona o incarnato spento |
| TON-09 | Tramonto | Dominante creativa preservata | Neutralizzazione automatica |
| TON-10 | Interno con finestra | Nessuna promessa di risolvere due gamme estreme | Compressione piatta dell'intera scena |

## Persone ed eventi

| ID | Caso | Risultato atteso | Fallimento da segnalare |
|---|---|---|---|
| PEO-01 | Pelle chiara, media e scura in luce giorno | Identita' del look senza hue shift innaturale | Ottimizzazione su una sola carnagione |
| PEO-02 | Pelle sotto tungsteno | Calore distinguibile da dominante problematica | Neutralizzazione completa o arancione eccessivo |
| PEO-03 | Illuminazione mista | Warning e compromesso coerente | Correzione globale dichiarata perfetta |
| PEO-04 | Abito bianco e completo nero | Dettaglio controllato a entrambe le estremita' | Clipping o neri sollevati indiscriminatamente |
| PEO-05 | Luce LED/DJ e neon | Colori scena preservati con gamut monitorato | Pelle grigia o canali troncati |
| PEO-06 | Gruppo con volti in luci diverse | Nessuna ottimizzazione che sacrifica una zona | Decisione basata solo sul volto dominante |

## Colore e contenuto

| ID | Caso | Risultato atteso | Fallimento da segnalare |
|---|---|---|---|
| COL-01 | Fogliame intenso | Verdi controllati senza collasso | Tutti i verdi convergono allo stesso tono |
| COL-02 | Cielo blu/ciano | Gradiente liscio | Banding o hue discontinuity |
| COL-03 | Rossi saturi | Clipping per canale monitorato | Tessuto o fiori senza dettaglio cromatico |
| COL-04 | Pastelli | Separazione delicata conservata | Saturazione uniforme |
| COL-05 | Neutri e ColorChecker | Neutral axis misurabile | Cast non previsto dal look |
| COL-06 | Gradienti sintetici | Nessuna discontinuita' visibile | Celle LUT evidenti o posterizzazione |
| COL-07 | Dominante creativa intenzionale | Mantenuta dopo conferma | Correzione WB automatica |

## Coerenza e generalizzazione

| ID | Caso | Risultato atteso | Fallimento da segnalare |
|---|---|---|---|
| GEN-01 | Stessa scena Fuji/Canon/Sony | Intenzione simile entro tolleranze dichiarate | Promessa di uguaglianza pixel |
| GEN-02 | Reference tutte all'aperto, prova in interno | Confidenza ridotta e warning dominio | Applicazione sicura dichiarata senza evidenza |
| GEN-03 | Reference incoerenti | Cluster/outlier e richiesta di scelta | Media che produce un look senza identita' |
| GEN-04 | Reference singola | Modalita' esplorativa e bassa confidenza | Profilo “professionale” dichiarato definitivo |
| GEN-05 | Paired RAW/JPEG coerenti | Trasformazione stimata e validata su holdout | Overfit alle coppie di training |
| GEN-06 | Foto di prova usata anche come reference | Warning sulla validazione non indipendente | Metriche presentate come generalizzazione |
| GEN-07 | Nuova versione algoritmo | Ricetta precedente riproducibile | Cambiamento silenzioso del look |

## Compatibilita' Lightroom

| ID | Caso | Risultato atteso | Fallimento da segnalare |
|---|---|---|---|
| LRC-01 | Import ZIP in Lightroom Classic supportato | Profilo e preset visibili nel gruppo FileX | Import parziale non rilevato |
| LRC-02 | Applicazione a RAW | Profilo creativo disponibile | Dipendenza involontaria dal modello camera |
| LRC-03 | Applicazione a JPEG | Look disponibile con warning se necessario | Preset marcato RAW-only per errore |
| LRC-04 | Amount Soft/Standard/Strong | Progressione monotona e coerente | Tre look divergenti |
| LRC-05 | Auto Base su scene diverse | Regolazione diversa per immagine, gestita da Lightroom | Valori statici spacciati per automatici |
| LRC-06 | Preset senza profilo installato | Incompatibilita' riconoscibile | Risultato silenziosamente diverso |
| LRC-07 | Mobile | Procedura documentata per versione/piattaforma | ZIP universale promesso senza test |

## Scheda evidenze

Per ogni esecuzione registrare:

- ID caso e versione fixture;
- versione app, decoder, algoritmo ed exporter;
- hash di input e output;
- decisioni del fotografo;
- screenshot FileX e Lightroom;
- metriche predefinite;
- risultato atteso/effettivo;
- severita': bloccante, alta, media, bassa;
- reviewer tecnico e reviewer fotografico.

