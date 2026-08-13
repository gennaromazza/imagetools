# Requisiti di prodotto e regole di sincronizzazione

## Obiettivo

Rendere affidabile il comportamento reale degli studi fotografici con archivi da 10-12 TB: una copia principale sul computer o storage primario e un clone esterno che puo' essere portato fuori studio.

## Ruoli invariabili

- **Master:** fonte di verita', registrata tramite identita' del volume e percorso radice.
- **Clone:** copia destinata a diventare uguale al master dopo ogni sincronizzazione.
- **Catalogo di baseline:** fotografia logica dell'ultima sincronizzazione completata e verificata.

Backup Guard non offre un pulsante per invertire i ruoli. Un cambio master richiede una procedura guidata separata, verifica completa e conferma esplicita.

## Matrice delle decisioni

| Baseline | Master attuale | Clone attuale | Interpretazione | Azione |
|---|---|---|---|---|
| assente | presente | assente | nuovo nel master | copia verificata al clone |
| assente | assente | presente | nuovo sul clone | importa nel master, poi verifica |
| presente | presente invariato | assente | cancellato dal clone | ripristina dal master |
| presente | assente | presente invariato | cancellato dal master | elimina dal clone |
| presente | modificato | invariato | modifica master | aggiorna il clone |
| presente | invariato | modificato | modifica clone | conflitto; non sostituire il master |
| presente | modificato | modificato | doppia modifica | conflitto; conserva entrambe |
| presente | assente | modificato | cancellato master, modificato clone | conflitto; nessuna eliminazione automatica |
| presente | assente | assente | eliminato su entrambi | registra la cancellazione |

Un elemento solo sul clone e' importabile come nuovo esclusivamente se il suo percorso o la sua identita' non appartengono alla baseline. Questa distinzione impedisce di reimportare elementi volutamente eliminati dal master.

## Flusso principale

1. Identificare master e clone.
2. Verificare accessibilita', filesystem, spazio e stato dei volumi.
3. Eseguire scansione incrementale senza scritture.
4. Costruire un piano con aggiunte, aggiornamenti, importazioni, cancellazioni e conflitti.
5. Mostrare il riepilogo in linguaggio comprensibile.
6. Richiedere conferma quando il piano contiene cancellazioni o conflitti.
7. Eseguire operazioni tramite staging e journal.
8. Verificare i contenuti trasferiti.
9. Pubblicare la nuova baseline soltanto dopo il completamento.
10. Salvare cronologia e stato protezione dei lavori.

## Requisiti funzionali

- BG-FUN-001: associare una radice master e un clone identificato.
- BG-FUN-002: impedire che i due percorsi risiedano sullo stesso volume fisico.
- BG-FUN-003: produrre un piano differenze prima di ogni mutazione.
- BG-FUN-004: copiare nuovi elementi e aggiornamenti dal master al clone.
- BG-FUN-005: propagare al clone le cancellazioni intenzionali rilevate sul master.
- BG-FUN-006: ripristinare dal master gli elementi eliminati soltanto sul clone.
- BG-FUN-007: importare dal clone esclusivamente elementi nuovi e senza collisioni.
- BG-FUN-008: bloccare e isolare ogni conflitto.
- BG-FUN-009: riprendere trasferimenti interrotti senza duplicazioni.
- BG-FUN-010: verificare ogni trasferimento con checksum.
- BG-FUN-011: mantenere cronologia permanente e ricercabile.
- BG-FUN-012: offrire controllo rapido e verifica profonda.
- BG-FUN-013: proteggere pacchetti Lightroom coerenti.
- BG-FUN-014: ricevere nuovi lavori da Archivio Flow.

## Criteri di completamento

Una sessione e' completata solo quando tutte le operazioni non conflittuali sono concluse, i checksum richiesti coincidono, il journal e' chiuso, la baseline e' pubblicata atomicamente e la cronologia contiene il risultato finale.

