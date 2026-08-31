# Flusso Photoshop

## Obiettivo

Photoshop è un passaggio professionale opzionale del flusso FileX ID Photo. Il fotografo può intervenire sulla singola fotografia senza modificare l'originale e rientrare nella commessa mantenendo tracciabilità, controlli e revisioni.

## Workflow operativo

1. FileX crea una copia di lavoro nell'area gestita della commessa.
2. L'operatore sceglie Photoshop rilevato oppure configura l'eseguibile.
3. FileX apre esclusivamente la copia di lavoro, mai l'originale.
4. La commessa entra nello stato **In modifica Photoshop**.
5. Se Photoshop salva sullo stesso file, FileX rileva la variazione e propone la ricarica.
6. Alla ricarica FileX crea uno snapshot distinto, azzera crop e approvazioni e ripete i controlli tecnici.
7. Le revisioni conservate sono ripristinabili; il rollback crea una nuova copia modificabile e non sovrascrive lo snapshot.
8. Se Photoshop usa **Salva con nome**, l'operatore seleziona esplicitamente il risultato, che viene copiato nell'area gestita prima della ricarica.
9. Il rientro accetta un file flattenato e realmente decodificabile in TIFF, JPG o PNG.
10. La revisione rientrata torna ai controlli del profilo prima dell'impaginazione.

Il bridge FileX espone selezione editor, elenco dei candidati installati, apertura dell'editor, scelta del file, lettura dello stato del file e gestione confinata delle copie di lavoro. FileX ID Photo usa queste capacità in un workflow esplicito e non distruttivo, con polling su dimensione e data di modifica, snapshot e rollback.

## Integrità e sicurezza

- Le copie di lavoro risiedono sotto la radice gestita di FileX.
- I percorsi vengono normalizzati e validati dal processo desktop.
- La creazione della copia è atomica e non sovrascrive file esistenti.
- L'originale rimane sempre separato da working copy, revisioni e output.
- La pulizia delle copie gestite richiede un'azione esplicita dell'operatore.
- Il ritorno da Photoshop invalida le approvazioni precedenti e richiede una nuova verifica.

## Limiti noti

- L'apertura dell'editor non dimostra che la fotografia sia stata salvata.
- **Salva con nome** richiede un rientro esplicito finché non esiste un monitoraggio affidabile della destinazione.
- Il selettore desktop può mostrare PSD, ma il decoder nativo non ha un supporto PSD verificato per anteprima ed export; il rientro richiede TIFF, JPG o PNG flattenato.
- Non sono previste Azioni Photoshop automatiche nella prima versione. Questa estensione richiede un requisito separato, prove su installazioni reali e gestione degli errori di script.

## Verifiche richieste prima della release

- Photoshop assente o non configurato;
- rilevamento e selezione dell'eseguibile;
- salvataggio sul file di lavoro;
- rientro tramite **Salva con nome**;
- file non decodificabile o non supportato;
- snapshot e rollback di più revisioni;
- eliminazione delle sole copie gestite;
- verifica che l'originale non cambi mai.
