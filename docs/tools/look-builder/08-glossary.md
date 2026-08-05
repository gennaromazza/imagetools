# Glossario centrale

Questo glossario e' normativo per requisiti, UI, codice, audit e assistenza. Se un documento usa un termine con un significato differente deve dichiararlo esplicitamente.

| Termine | Definizione | Da non confondere con |
|---|---|---|
| **Base tecnica** | Trasformazione controllata che porta l'immagine a un punto di partenza leggibile, preservando l'intenzione della scena. Puo' comprendere tono, esposizione percepita e protezione dal clipping. | Look creativo, normalizzazione obbligatoria dell'istogramma o sviluppo finale. |
| **Look** | Insieme delle scelte estetiche riutilizzabili: risposta tonale, palette, contrasto, cromia e comportamento delle intensita'. Nel dominio e' rappresentato da una recipe indipendente dal formato Adobe. | Correzione specifica della fotocamera o regolazione adattiva di una singola foto. |
| **Creative Profile** | Profilo Adobe applicabile a RAW e non-RAW che definisce una resa creativa senza dipendere dai cursori di sviluppo. Puo' incorporare una look table/3D LUT. | Camera Matching Profile o preset. |
| **Camera Matching Profile** | Profilo Adobe che tenta di riprodurre rese previste per uno specifico modello di fotocamera. La disponibilita' dipende dal file e dalla camera. | Look cross-brand. |
| **Preset** | File XMP che applica un profilo e/o valori di sviluppo Lightroom. Puo' includere Auto Tone quando supportato. | Profilo: il preset puo' richiamarlo, ma non lo sostituisce. |
| **Recipe** | Rappresentazione strutturata, versionata e indipendente dall'UI delle decisioni che compongono base o look. E' l'input dell'esportatore XMP. | Immagine sviluppata o LUT binaria. |
| **Reference** | Fotografia scelta per comunicare una direzione estetica o, in una coppia RAW/JPEG, mostrare un risultato finale desiderato. | Foto di prova. |
| **Foto di prova** | Immagine rappresentativa sulla quale l'utente valuta le proposte durante la costruzione del look. | Reference usata per stimare il look o holdout indipendente. |
| **Holdout** | Foto esclusa dal fitting e dalle decisioni iniziali, utilizzata per verificare che il look generalizzi oltre gli esempi da cui deriva. | Reference o semplice preview. |
| **Renderer** | Motore e configurazione che trasformano dati immagine e recipe in pixel visibili. Il renderer FileX e quello Lightroom possono produrre differenze. | Decoder: il decoder interpreta il file, il renderer costruisce la resa visibile. |
| **Canonical image** | Rappresentazione interna lineare e color-managed, accompagnata da spazio di lavoro, provenienza e diagnostica. Costituisce il contratto comune tra ingest e motore colore. | JPEG incorporato nel RAW o bitmap privo di metadati. |
| **Input transform** | Passaggio camera/file-specifico che interpreta RAW o JPEG e lo porta nello spazio di lavoro canonico. | Look creativo. |
| **Look table / 3D LUT** | Campionamento tridimensionale di una trasformazione RGB usato dal Creative Profile. | Recipe completa: non contiene necessariamente tutte le decisioni del progetto. |
| **Identity LUT** | LUT che lascia invariati i valori. Serve come riferimento, test e punto iniziale per il blending dell'intensita'. | Look neutro percettivo, che puo' comunque dipendere dal rendering di base. |
| **Soft / Standard / Strong** | Varianti di intensita' ottenute dalla stessa recipe tramite blending controllato con l'identita'. | Tre fitting o tre look indipendenti. |
| **Auto Base** | Variante di preset che delega a Lightroom regolazioni adattive per immagine, come Auto Tone, se approvata e supportata. | Base tecnica FileX incorporata staticamente nella LUT. |
| **Clipping** | Perdita o saturazione di informazione a un estremo o in uno o piu' canali. Nel JPEG puo' essere irreversibile. | Assenza intenzionale di valori agli estremi dell'istogramma. |
| **Outlier** | Reference le cui caratteristiche differiscono in modo significativo dal gruppo e che potrebbe destabilizzare il fitting. | File invalido: un outlier puo' essere tecnicamente corretto e artisticamente intenzionale. |
| **Confidenza** | Indicatore della solidita' delle evidenze disponibili per una proposta o un avviso. Non e' una garanzia estetica. | Punteggio di qualita' assoluto. |
| **Audit** | Traccia strutturata e riproducibile di input, versioni, metriche, decisioni e validazioni. | Telemetria cloud o semplice log testuale. |
| **Golden fixture** | Asset di test autorizzato con risultato o proprieta' attese e versionate. | Fotografia di cliente usata temporaneamente per debug. |
| **Round-trip Lightroom** | Import del pacchetto in Lightroom, applicazione e successiva verifica o riesportazione per confermare compatibilita' e comportamento. | Sola validazione sintattica XMP. |

## Convenzioni linguistiche UI

- Nell'interfaccia italiana usare `foto di riferimento`; nei contratti tecnici e' ammesso `reference`.
- Usare `foto di verifica` nell'UI quando il concetto formale di holdout sarebbe troppo tecnico; l'Audit puo' mostrare `holdout`.
- Mostrare `profilo creativo` al fotografo e `Creative Profile XMP` nei dettagli tecnici.
- Non usare `filtro`, `preset`, `profilo` e `LUT` come sinonimi.
- Non descrivere la base tecnica come “correzione perfetta” o “istogramma corretto”.

