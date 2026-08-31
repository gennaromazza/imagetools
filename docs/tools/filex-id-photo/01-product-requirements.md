# Requisiti di prodotto

## Utenti e contesto

FileX ID Photo è una postazione operativa per:

- fotografi di studio;
- negozi fotografici e laboratori;
- operatori che producono più fototessere al giorno;
- professionisti che alternano preparazione interna e ritocco manuale in Photoshop.

L'unità di lavoro non è la singola immagine isolata, ma una **commessa cliente**. La commessa mantiene riferimenti alle sorgenti, alle versioni di lavoro, al profilo documento applicato e agli output creati.

## Flusso principale

1. L'operatore apre o crea una commessa.
2. Seleziona una cartella e identifica la foto da usare.
3. Sceglie il profilo documento e il numero di copie.
4. Prepara la foto con crop, strumenti locali e, se necessario, Photoshop.
5. Controlla avvisi, geometria e regole del profilo.
6. Sceglie foglio, carta, guida di taglio e destinazione.
7. Genera l'output, lo stampa o lo consegna al flusso di stampa del negozio.
8. Archivia la commessa o elimina le risorse temporanee secondo la retention scelta.

Ogni fase deve essere riapribile. Il passaggio allo step successivo non può distruggere lavoro precedente.

## Requisiti funzionali

| ID | Requisito | Criterio di completamento |
|---|---|---|
| IDP-FUN-001 | Creare e riaprire una commessa locale | La commessa conserva stato e riferimenti senza copiare o modificare automaticamente gli originali |
| IDP-FUN-002 | Importare una cartella fotografica | Sono preparate al massimo 500 foto per commessa come thumbnail leggere; soltanto la foto selezionata mantiene una preview di dettaglio, mentre i file oltre soglia, esclusi o non decodificabili sono dichiarati nella diagnostica |
| IDP-FUN-003 | Selezionare una foto primaria | L'operatore può cambiare selezione senza perdere le altre foto della cartella |
| IDP-FUN-004 | Creare una versione di lavoro non distruttiva | Originale, copia di lavoro, revisioni Photoshop e output finale restano distinguibili |
| IDP-FUN-005 | Applicare un profilo documento | Il profilo espone fonte, versione, misure, policy immagine e controlli previsti |
| IDP-FUN-006 | Gestire crop manuale guidato | Guide di volto, occhi e ingombro sono modificabili e non sostituiscono il giudizio del fotografo |
| IDP-FUN-007 | Eseguire controlli tecnici | Il sistema separa condizioni bloccanti, avvisi e informazioni; non afferma conformità garantita |
| IDP-FUN-008 | Aprire Photoshop | Photoshop riceve una copia di lavoro e FileX conserva sempre il collegamento all'originale |
| IDP-FUN-009 | Rientrare da Photoshop | Un salvataggio sul file di lavoro aggiorna la commessa; un Salva con nome può essere reimportato esplicitamente |
| IDP-FUN-010 | Impaginare le copie | Il motore calcola copie, margini, spaziature e guide su fogli fisici supportati |
| IDP-FUN-011 | Esportare output di stampa | Ogni formato prodotto ha specifica, metadati e verifica di dimensione documentata |
| IDP-FUN-012 | Preparare la stampa | Stampante, carta e calibrazione sono selezionabili soltanto quando il bridge nativo è implementato e testato |
| IDP-FUN-013 | Gestire la retention | L'operatore può chiudere la commessa mantenendo o eliminando in modo esplicito versioni temporanee |

## Requisiti di esperienza operatore

- Il flusso normale deve richiedere pochi click e restare leggibile su una postazione da banco.
- La foto attiva è sempre visibile nell'area principale.
- Gli strumenti avanzati non nascondono le azioni di commessa, profilo, Photoshop, impaginazione e stampa.
- Un warning deve spiegare la causa, l'impatto e l'azione disponibile.
- I messaggi usano linguaggio fotografico e operativo, non termini interni del motore.
- L'operatore può ripetere un ordine già prodotto senza ricostruire manualmente crop e foglio.

## Regole di versione e immutabilità

Ogni commessa deve distinguere almeno:

    originale
    copia di lavoro locale
    revisione Photoshop approvata, se presente
    output di stampa

Una revisione non sovrascrive il file che la precede. Se una copia deve essere sostituita nel flusso operativo, il sistema registra il nuovo riferimento e conserva il precedente finché la policy di retention non lo elimina esplicitamente.

## Stati della commessa

| Stato | Significato |
|---|---|
| Bozza | Cartella o cliente impostati, nessuna foto approvata |
| In preparazione | Foto attiva con modifiche locali o Photoshop in corso |
| Da verificare | Il crop o il profilo è cambiato e gli avvisi devono essere riesaminati |
| Approvata | Il fotografo ha confermato la foto per l'impaginazione |
| Impaginata | Esiste un piano di fogli ricalcolabile |
| Pronta alla stampa | Esiste un output verificato pronto al driver o al laboratorio |
| Consegnata | Output conservato o archiviato secondo la policy |
| Annullata | Commessa chiusa senza output; gli originali non vengono toccati |

## Requisiti non funzionali

- Funzionamento locale per import, analisi, elaborazione ed export.
- Nessuna dipendenza da un credito a consumo per il percorso standard.
- Nessuna perdita silenziosa di lavoro dopo errore, chiusura Photoshop o annullamento export.
- Gestione esplicita di file mancanti, rinominati, modificati o non più decodificabili.
- Le dimensioni fisiche devono derivare da millimetri e DPI, non da una semplice scala CSS.
- L'anteprima non deve allocare il foglio alla piena risoluzione di stampa quando basta una visualizzazione ridotta.
- La rail non deve decodificare simultaneamente le sorgenti originali: usa thumbnail ridotte con caricamento lazy e conserva una sola preview di dettaglio revocabile per la foto attiva.
- Le operazioni con immagini grandi devono esporre stato e consentire annullamento sicuro dove tecnicamente possibile.

## Criteri di accettazione della prima versione

La prima versione è pronta per una prova pilota soltanto se:

1. il fotografo può completare una commessa senza alterare l'originale;
2. il ritorno manuale da Photoshop è affidabile su salvataggio in-place e Salva con nome;
3. i profili italiani inclusi rimandano a fonti ufficiali aggiornate;
4. l'output 10×15 e 15×20 contiene il numero corretto di copie nelle dimensioni attese;
5. il foglio stampato viene misurato su almeno le stampanti e le carte di riferimento approvate;
6. installer, UI e documentazione descrivono soltanto le funzioni realmente disponibili;
7. tutte le funzioni fotografiche restano disponibili senza rete;
8. test, build Electron e installazione reale superano i gate descritti nel documento di validazione.
