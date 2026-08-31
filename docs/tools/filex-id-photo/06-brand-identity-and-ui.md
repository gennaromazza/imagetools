# Brand identity e UI

## Posizionamento

FileX ID Photo è la postazione rapida e controllata del fotografo per preparare fototessere e fogli documenti. Deve apparire precisa, calma e professionale: non un'app consumer con effetti automatici, né un editor grafico generico.

Promessa UI:

> Tu controlli la foto. FileX prepara il percorso, misura il risultato e rende il foglio pronto alla stampa.

## Palette FileX

La base grafica segue la palette già documentata per FileX Backup Guard, adattata al flusso fotografico:

| Ruolo | Colore | Uso |
|---|---|---|
| Fondo FileX | #1F2421 | Shell e aree scure |
| Verde profondo | #123F35 | Azione principale, identità FileX |
| Pannello | #2B312D | Superfici scure secondarie |
| Oro FileX | #B89A63 | Guide volto, focus e attenzione non bloccante |
| Testo avorio | #F2ECE5 | Testo su fondo scuro |
| Verifica | #8EB28E | Controlli superati |
| Informazione | #4E8F91 | Stato tecnico non critico |
| Pericolo controllato | #D4A39C | Errori e blocchi |

Il colore non è l'unico canale di stato: ogni esito espone icona, testo e istruzione. L'oro non sostituisce il verde come azione principale e Photoshop non deve diventare il colore dominante della UI.

## Struttura della finestra

    top bar: nome tool, commessa attiva, stato salvataggio, Tutorial
    stepper: Commessa | Prepara | Verifica | Impagina | Esporta
    area centrale: foto attiva e lavoro del passo corrente
    pannello sinistro: scelta o configurazione
    pannello destro: controlli, esito e azioni successive
    footer: stato, output e messaggi non invasivi

Il flusso è lineare, ma gli step già completati restano cliccabili. Non usare un wizard che nasconde il lavoro precedente o obbliga a ricominciare.

### Wireframe operativo

    +--------------------------------------------------------------------------------+
    | FileX ID Photo              Commessa: Rossi Mario       Salvato   Tutorial    |
    +--------------------------------------------------------------------------------+
    | 1 Commessa | 2 Prepara | 3 Verifica | 4 Impagina | 5 Esporta                  |
    +----------------------+--------------------------------+------------------------+
    | Foto / configurazione|        FOTO ATTIVA             | Controlli e stato      |
    |                      |     crop, guide, anteprima     | profilo, avvisi,       |
    | cartella, cliente,   |     Photoshop, anteprima        | azione successiva      |
    | foglio o stampante   |                                |                        |
    +----------------------+--------------------------------+------------------------+
    | Stato commessa, output attivo, messaggi operativi e progresso                 |
    +--------------------------------------------------------------------------------+

L'area centrale resta dedicata alla fotografia; sidebar e pannello esito non devono sottrarle spazio con impostazioni secondarie.

## Tutorial sempre disponibile

Il pulsante **Tutorial** deve restare visibile in ogni step, anche nelle finestre più strette. L'apertura mostra un pannello laterale che non interrompe né modifica la commessa corrente.

- si apre direttamente sul capitolo dello step in uso;
- consente di consultare tutti e cinque i capitoli senza cambiare lo step operativo;
- ogni capitolo contiene obiettivo, azioni ordinate e un punto di attenzione professionale;
- il capitolo Prepara spiega copia di lavoro, salvataggio e rientro da Photoshop;
- il pannello si chiude senza perdere crop, verifiche, layout o destinazione di export;
- il richiamo flottante resta disponibile quando il pulsante della top bar viene nascosto per mancanza di spazio.

## Step 1: Commessa

Obiettivo: selezionare cartella, foto e profilo iniziale senza sovraccaricare la postazione.

- campo commessa o cliente opzionale;
- pulsante chiaro per importare la cartella;
- elenco foto con miniatura, stato decodifica e motivo dello scarto;
- foto attiva grande al centro;
- azione primaria: Continua alla preparazione.

Non mostrare foglio o stampa in questa fase.

## Step 2: Prepara

Obiettivo: lavorare la singola foto mantenendo il fotografo al comando.

- anteprima della foto con guide di inquadratura;
- zoom, posizione e rotazione controllati dal fotografo;
- azione Modifica in Photoshop ben visibile;
- stato In modifica Photoshop, con percorso della copia di lavoro e azione Importa file salvato;
- indicazione chiara degli interventi consentiti dal profilo documento.

Photoshop deve essere un passaggio professionale normale, non un menu nascosto né una scorciatoia che modifica l'originale.

## Step 3: Verifica

Obiettivo: rendere evidente il rapporto tra foto e profilo documento.

- selettore profilo;
- crop con guida volto, linea occhi e area testa/spalle quando il profilo le definisce;
- lista di blocchi, avvisi e controlli superati;
- link alla fonte e alla versione del profilo;
- azione primaria: Approva per impaginazione.

Il copy deve dire ad esempio Controlla il riflesso sugli occhiali, non Errore 14. Non usare la parola certificata.

## Step 4: Impagina

Obiettivo: produrre il foglio senza calcoli manuali.

- scelta carta: 10×15 e 15×20;
- numero copie e guide di taglio;
- anteprima del foglio con misure e DPI;
- riepilogo foto, profilo, quantità e output;
- azione primaria: Genera anteprima stampa.

Il prodotto deve distinguere la foto documento dal foglio: il fotografo sceglie la prima una volta, poi gestisce le copie.

## Step 5: Esporta

Obiettivo: chiudere una commessa in modo controllato.

- destinazione dell'export;
- scelta PDF o JPG e qualità JPG;
- istruzione di stampa al 100%, senza adattamento pagina;
- riepilogo immutabile dell'output;
- azione Esporta fogli;
- verifica locale dell'integrità dei file creati.

Finché il bridge nativo non è implementato, la UI deve offrire solo l'export pronto alla stampa e non simulare l'elenco stampanti.

## Accessibilità e ergonomia

- contrasto WCAG AA;
- focus tastiera evidente;
- target cliccabili adatti a mouse e touch;
- scorciatoie documentate solo dopo verifica;
- messaggi dinamici in area live accessibile;
- progresso espresso con testo, conteggi e stato, non solo con animazione;
- azioni distruttive o di pulizia temporanei richiedono spiegazione e conferma;
- interfaccia adatta a 1280×720 come minimo, senza nascondere l'azione primaria.

## Asset

Prima della release servono:

- icona FileX ID Photo in PNG master e ICO multirisoluzione;
- variante leggibile su taskbar chiara e scura;
- anteprime e mockup senza fotografie reali di clienti;
- testo marketing che descriva esclusivamente capacità già verificate.
