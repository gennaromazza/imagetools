# Requisiti e percorso UX

## Problema

Un preset creato manualmente in Lightroom salva regolazioni gia' note. Look Builder risolve un problema diverso: aiuta il fotografo a scoprire e formalizzare un look coerente partendo da reference, prove visive e preferenze, quindi lo consegna in un formato riutilizzabile.

La promessa corretta e': **creare una base estetica professionale e coerente da rifinire in Lightroom**, non terminare automaticamente ogni fotografia e non riprodurre perfettamente una reference isolata.

## Utente principale

Fotografo professionista o studio che:

- possiede immagini RAW e/o JPEG di diversi lavori;
- vuole mantenere un'identita' riconoscibile anche cambiando corpo macchina;
- lavora gia' in Lightroom;
- non vuole caricare fotografie di clienti sul cloud;
- desidera capire perche' il look funziona o fallisce.

## Modalita' di partenza

### Esplora

Il tool propone famiglie di look costruite da archetipi parametrici interni: pulito, morbido, editoriale, caldo, freddo, contrasto controllato, colori attenuati e simili. Non distribuisce o copia preset commerciali di terzi.

### Da reference

L'utente carica fotografie di riferimento proprie o utilizzabili legittimamente. Il tool estrae tendenze robuste di tono e colore, segnala reference tra loro incompatibili e propone una o piu' interpretazioni.

### Impara il mio stile

L'utente fornisce coppie coerenti, preferibilmente RAW originale e JPEG finale esportato. Questa modalita' stima la trasformazione tra punto di partenza e risultato ed e' piu' affidabile della sola imitazione visiva.

## Flusso guidato

1. **Nuovo progetto**: nome del look, destinazione Lightroom e modalita' di partenza.
2. **Reference**: import di un insieme piccolo e intenzionale; il tool mostra qualita', profilo colore, fotocamera, esposizione e coerenza.
3. **Foto di prova**: scelta di scene rappresentative, idealmente diverse dalle reference.
4. **Base tecnica**: scelta tra nessuna correzione, base neutra suggerita o Auto Tone Lightroom nel preset dedicato.
5. **Proposte**: da quattro a sei direzioni iniziali con descrizione delle differenze.
6. **Preferenze A/B**: confronti mirati su contrasto, temperatura percepita, saturazione, pelle, verdi, blu e roll-off delle alte luci.
7. **Validazione**: griglia uniforme sulle foto di prova, confronto prima/dopo, avvisi su clipping, dominanti e instabilita'.
8. **Conferma**: nome, intensita', varianti e compatibilita' dichiarata.
9. **Esporta**: generazione del solo ZIP. Nessuna esportazione di fotografie sviluppate.

I numeri di reference e prove saranno definiti dopo un benchmark. Come ipotesi di ricerca: 8-20 reference e 3-10 foto di prova; il prodotto deve privilegiare la qualita' e diversita' delle immagini rispetto al volume.

## Output previsto

Il pacchetto finale deve contenere esclusivamente file accettati dal percorso di import Lightroom. Contratto proposto, da verificare con un prototipo di compatibilita':

- un Creative Profile XMP con il look;
- preset XMP `Soft`, `Standard` e `Strong` che applicano lo stesso profilo con intensita' diverse;
- un preset opzionale `Standard + Auto Base` che abilita le regolazioni automatiche supportate da Lightroom;
- eventuale preset `Look only`, privo di tono automatico.

Il manifest diagnostico del progetto rimane separato nel workspace locale: file JSON o README aggiuntivi nel pacchetto potrebbero interferire con gli importatori e saranno ammessi solo dopo test espliciti.

## Requisiti funzionali

- leggere metadati e preview di RAW e JPEG senza modificare gli originali;
- rispettare orientamento e profilo ICC dei JPEG;
- distinguere il JPEG incorporato nel RAW dalla decodifica lineare usata per l'analisi;
- mostrare sempre quale rappresentazione e' in uso;
- produrre risultati deterministici a parita' di input, versione e decisioni;
- salvare e riaprire il progetto senza incorporare fotografie per impostazione predefinita;
- consentire il relink dei file spostati;
- consentire di escludere una reference problematica senza ricominciare;
- conservare tutte le decisioni del percorso A/B;
- validare LUT, XMP e ZIP prima dell'esportazione;
- generare un bundle diagnostico privacy-safe su richiesta.

## Requisiti non funzionali

- elaborazione interamente locale;
- funzionamento offline dopo installazione e attivazione secondo le policy FileX;
- nessuna telemetria delle immagini; telemetria tecnica soltanto opt-in e aggregata;
- isolamento dei decoder nativi dal processo UI;
- annullamento di operazioni lunghe e recupero dopo crash;
- accessibilita' dei confronti: non affidarsi soltanto al colore per comunicare errori;
- versionamento di progetto, algoritmo ed esportatore;
- supporto iniziale Windows coerente con FileX Suite.

## Non-obiettivi

- catalogare o selezionare un servizio fotografico;
- elaborare o esportare centinaia di immagini;
- sostituire il motore RAW di Lightroom;
- garantire un'anteprima pixel-identica ad Adobe Camera Raw;
- recuperare informazioni gia' clippate in un JPEG;
- copiare esattamente il grading di una fotografia singola senza informazioni sufficienti;
- creare maschere locali, ritocco pelle o compositing;
- distribuire dataset, preset o reference di terzi senza licenza.

## Criteri di accettazione del prodotto

Il primo rilascio e' accettabile quando:

- un progetto misto RAF/JPEG produce lo stesso pacchetto in esecuzioni ripetute;
- il pacchetto importa nelle versioni Lightroom dichiarate nella matrice di supporto;
- il profilo creativo e' applicabile sia a RAW sia a JPEG supportati;
- le varianti mantengono identita' e neutralita' controllata senza inversioni tonali;
- high-key, low-key, nebbia e silhouette non vengono automaticamente normalizzati verso un istogramma pieno;
- l'utente puo' ricostruire ogni decisione tramite l'audit;
- input non supportati falliscono in modo isolato e comprensibile;
- il software non scrive mai negli originali.

