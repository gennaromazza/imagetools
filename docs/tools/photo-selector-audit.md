# Image Select Pro — Audit e test

Questo documento definisce il contratto UX del tool e la matrice minima da ripetere dopo ogni modifica alla navigazione o alla selezione.

## Flusso canonico

1. **Sfoglia**: apertura di una cartella nuova o recente.
2. **Selezione**: scelta, classificazione e revisione delle foto.
3. **Riepilogo**: vista rapida dello stato della selezione.
4. **Esporta**: export della selezione o di formati secondari.

La diagnostica cartella è un contesto persistente compatto. I dettagli si aprono solo su richiesta. Impostazioni, cache, editor esterno e scorciatoie sono funzioni secondarie.

## Audit automatico

Eseguire dalla root del repository:

    npm run audit:photo-selector

Per rendere il typecheck bloccante:

    powershell -ExecutionPolicy Bypass -File scripts/audit-photo-selector.ps1 -StrictTypecheck

Il controllo statico verifica:

- contratto della navigazione e del Riepilogo rapido;
- presenza della diagnostica richiudibile;
- assenza della diagnostica duplicata nel caricamento;
- raggruppamento degli export secondari;
- assenza di riferimenti a funzioni rimosse;
- regole responsive dell’header;
- stato del typecheck, oggi informativo finché non vengono risolti gli errori preesistenti.

## Matrice manuale

| ID | Scenario | Risultato atteso |
|---|---|---|
| NAV-01 | Avvio senza cartella | Solo Sfoglia è operativa; nessuna diagnostica visibile. |
| NAV-02 | Apertura cartella con foto | L’app entra in Selezione; il caricamento resta non bloccante. |
| NAV-03 | Cambio cartella | Selezione e diagnostica vengono sostituite dalla nuova cartella. |
| NAV-04 | Cartella vuota | Si resta in Sfoglia con messaggio chiaro e diagnostica sintetica. |
| NAV-05 | Riepilogo con selezione | Mostra statistiche e CTA Esporta selezione. |
| NAV-06 | Riepilogo con zero selezioni | Mostra stato vuoto e invito a tornare alla Selezione. |
| FOLDER-01 | Diagnostica chiusa | Mostra solo cartella, numero foto, eventuale avviso e Dettagli. |
| FOLDER-02 | Diagnostica aperta | Mostra i conteggi senza duplicare il pannello di caricamento. |
| FILTER-01 | Nessun risultato filtro | Mostra azione evidente per azzerare i filtri. |
| FILTER-02 | Filtri avanzati chiusi/aperti | La riga base resta leggibile; i filtri secondari compaiono solo su richiesta. |
| SELECT-01 | Selezione parziale | Conteggi header, toolbar e fondo pagina coincidono. |
| SELECT-02 | Selezione con filtri attivi | È chiaro se un’azione sostituisce, aggiunge o rimuove foto. |
| SELECT-03 | Da 2 a 4 foto selezionate nella griglia | Compare `Confronta (N)` anche se il progetto contiene selezioni non visibili; la modale rispetta l'ordine della griglia. |
| SELECT-04 | `Ctrl+B` nella griglia | Apre e richiude Confronta; con meno di 2 o più di 4 foto visibili mostra un messaggio operativo. |
| SELECT-05 | Scroll con foto selezionate o colorate | I bordi restano visibili e le ombre diffuse vengono sospese fino al termine dello scroll. |
| BROWSE-01 | Elenco cartelle recenti più alto della finestra | La pagina scorre fino all'ultima cartella mantenendo visibile la testata. |
| EXPORT-01 | Export principale | Scarica un JSON con il numero corretto di foto attive. |
| EXPORT-02 | Export secondari | Sono disponibili senza occupare la prima riga delle CTA. |
| LOAD-01 | Anteprime ancora in caricamento | L’utente può continuare a selezionare e può riaprire lo stato caricamento. |
| XMP-01 | Cartella senza scrittura | L’avviso è comprensibile e non blocca la selezione. |

## Scheda evidenze

Per ogni regressione annotare:

- ID scenario;
- cartella e numero immagini;
- profilo anteprime;
- stato iniziale della selezione;
- passaggi eseguiti;
- risultato atteso e risultato effettivo;
- screenshot o log desktop;
- severità: bloccante, alta, media, bassa.
