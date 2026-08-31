# Profili documento e integrità dell'immagine

## Principio di conformità

FileX ID Photo non emette certificazioni e non promette l'accettazione della fotografia da parte di un ente. Il prodotto aiuta il fotografo a rispettare un profilo verificabile; l'accettazione finale appartiene sempre all'autorità emittente.

Le regole non possono essere copiate da fonti non ufficiali o blog. Ogni profilo attivo deve registrare:

- ente o Paese di riferimento;
- nome del documento;
- identificatore e versione del profilo;
- URL o documento primario;
- data dell'ultima verifica;
- regole fisiche, digitali e di posa;
- policy sulle modifiche ammesse;
- livello di severità di ciascun controllo;
- data prevista per il prossimo riesame.

Un aggiornamento del profilo deve mantenere lo storico della versione usata da ogni commessa.

## Fonti iniziali da verificare e registrare

| Profilo candidato | Fonte primaria | Uso previsto |
|---|---|---|
| CIE Italia | [Modalità di acquisizione foto della CIE](https://www.cartaidentita.interno.gov.it/richiedi/modalita-di-acquisizione-delle-foto/) | Primo profilo italiano |
| CIE Italia, file digitale | [Photo acquisition process della CIE](https://www.cartaidentita.interno.gov.it/en/request-cie/photo-acquisition-process/) | Limiti digitali e consegna su supporto |
| Passaporto Italia | [Linee guida foto ICAO del MAECI](https://www.esteri.it/it/servizi-opportunita/italiani-all-estero/documenti_di_viaggio/linee-guida-foto-icao/) | Profilo ufficiale italiano 35×45 mm per passaporto elettronico |

Le fonti sono un punto di partenza documentale. Prima di pubblicare un profilo, il responsabile prodotto deve controllare il documento originale, datare il controllo e confermare che non esistano istruzioni locali più restrittive.

## Requisiti osservati per la CIE italiana

La pagina ufficiale CIE indica, tra le altre cose:

- larghezza 35 mm e altezza minima 45 mm;
- volto completo, non ruotato, con entrambi i lobi visibili;
- altezza del volto tra il 70% e l'80% dell'altezza della foto;
- altezza degli occhi rispetto alla base compresa tra 23 e 31 mm;
- sfondo uniforme e luce uniforme;
- colori naturali, assenza di ombre e riflessi;
- divieto di ritoccare, colorare o manomettere la foto;
- per il file digitale, JPG, almeno 400 DPI e massimo 500 KB.

Di conseguenza, il profilo CIE deve disabilitare la rimozione o sostituzione dello sfondo e ogni ritocco che modifichi l'immagine. Può mostrare la guida, misurare e segnalare incongruenze; non deve correggere automaticamente la posa o lo sfondo.

## Requisiti osservati per il passaporto italiano

La pagina ufficiale MAECI per passaporto elettronico e carta d'identità indica espressamente il formato **35×45 mm**. Richiede inoltre foto recente, a colori, espressione neutra, occhi aperti, sfondo bianco con luce uniforme, assenza di riflessi, viso pari al 70%-80% dell'immagine, messa a fuoco nitida, posa frontale e una sola persona nell'inquadratura.

Il catalogo implementa questi dati nel profilo ufficiale `it-passport-icao-35x45-v2`, versione `2.0.0`, con fonte MAECI e data di verifica 31 agosto 2026. Il fotografo deve comunque controllare le istruzioni dell'ufficio destinatario: una sede può pubblicare indicazioni operative ulteriori e FileX non garantisce l'accettazione del documento.

## Profili presenti nel MVP

- CIE Italia 35×45 mm, fonte Ministero dell'Interno;
- passaporto italiano 35×45 mm, fonte MAECI;
- documento generico 35×45 mm, dichiarato chiaramente come preset di studio e non come profilo ufficiale.

I profili sono versionati nel dominio di `apps/id-photo`; una commessa conserva l'identificatore della versione selezionata.

## Modello dati del profilo proposto

    id
    displayName
    jurisdiction
    documentType
    version
    sourceUrl
    sourceCheckedAt
    nextReviewAt
    imageWidthMm
    imageHeightMm oppure intervallo
    faceHeightRatioRange
    eyeLineFromBottomMmRange
    backgroundPolicy
    posePolicy
    colorPolicy
    digitalFilePolicy
    allowedEditingPolicy
    checks

Il renderer e l'UI ricevono le decisioni da questo modello. Nessuna regola deve restare dispersa in un componente React o in una stringa dell'interfaccia.

## Regole, avvisi e blocchi

| Tipo | Comportamento |
|---|---|
| Blocco | Impedisce la generazione finché l'operatore non modifica il dato o sceglie esplicitamente un profilo diverso |
| Avviso | Evidenzia un rischio, consente la continuazione con conferma e conserva la motivazione |
| Informazione | Mostra un dato utile senza richiedere un'azione |

Nella prima release i blocchi possono riguardare rapporto fisico incompatibile e risoluzione utile insufficiente; gli avvisi tecnici riguardano luminosità, contrasto, nitidezza e uniformità dello sfondo. Volto, espressione e accessori restano conferme manuali.

La classificazione definitiva di ogni regola deve essere approvata insieme al responsabile prodotto e al consulente competente; non va dedotta automaticamente.

## Integrità dell'immagine

Per ogni profilo il sistema deve dichiarare quali interventi sono:

- consentiti: ad esempio crop manuale richiesto dal profilo;
- assistiti: guida del volto, misurazione, analisi di nitidezza e avviso;
- vietati: modifiche che il profilo o la fonte proibiscono;
- non classificati: azioni che il prodotto non applica fino a verifica della policy.

Il motore conserva la provenienza disponibile: originale, revisione Photoshop e ultimo export. La prima release registra che una revisione arriva da Photoshop, ma non classifica automaticamente la natura del ritocco o se lo sfondo è stato modificato; questa verifica resta responsabilità dell'operatore e della policy mostrata dal profilo.

## Manutenzione del catalogo

1. Registrare una nuova fonte primaria o un aggiornamento.
2. Farla riesaminare da una persona responsabile.
3. Pubblicare una nuova versione del profilo, senza mutare le commesse storiche.
4. Eseguire test di geometria e casi visivi per le nuove regole.
5. Aggiornare guida e pagina marketing soltanto dopo la verifica.

Un profilo scaduto o senza fonte attiva deve essere segnalato e non può essere presentato come aggiornato.
