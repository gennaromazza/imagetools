# Audit licenze FileX — 7 settembre 2026

## Esito e ambito

Audit locale del backend licenze, prova gratuita, runtime condiviso dei tool, tre runtime autonomi, Suite, contratti IPC e percorso account/sito. Le anomalie riproducibili descritte sotto sono state corrette. Non è una certificazione anti-crack né un via libera alla pubblicazione: gli installer aggiornati e il flusso PayPal reale richiedono ancora il collaudo di release.

## Correzioni

- Le risposte 401/403 eliminano le credenziali rifiutate e non vengono trattate come semplici guasti di rete. Una revoca ricevuta con risposta 200 non consente di ripiegare sulla vecchia firma se la cache non è scrivibile. Il rifiuto resta memorizzato nel processo anche durante un successivo guasto di rete.
- Attivazione a pagamento, cache e tool autonomi richiedono attestazione Ed25519 valida. Le impostazioni locali di osservazione e l'URL di sviluppo non disabilitano i controlli negli eseguibili distribuiti.
- Scadenze finite, data di emissione, identità installazione e vincolo del dispositivo della prova sono verificati. Una prova consente al massimo 24 ore offline; l'abbonamento mantiene il limite firmato di 14 giorni.
- Un abbonamento ancora marcato active ma oltre la scadenza conosciuta non concede accesso. Pagamenti falliti ripetuti non spostano in avanti la cortesia. Rimborsi e chargeback non vengono annullati da notifiche o recuperi dell'acquisto successivi.
- Il recupero di acquisti e l'associazione all'account ricontrollano proprietà e aggiornamenti concorrenti nelle transazioni. Un recupero PayPal iniziato prima di un webhook più recente non ne sovrascrive lo stato.
- La cache condivisa usa scrittura atomica, lock tra processi e confronto delle credenziali. Una risposta tardiva non sovrascrive una nuova attivazione. La disattivazione remota già effettuata può essere recepita localmente.
- L'assenza della chiave di firma blocca le attivazioni; una licenza non utilizzabile non occupa uno slot. I riferimenti persistenti impediscono una nuova prova anche se il documento dell'abbonamento è stato perso. Il token di prova è distinto per sessione.
- Tutti i tool controllano la licenza anche durante l'esecuzione: avviso, 60 secondi per salvare, chiusura e fallback di uscita dopo ulteriori 5 secondi. Il rinnovo rilevato annulla la chiusura. La Suite resta disponibile. Questa scelta può interrompere un'elaborazione in corso ed è stata richiesta esplicitamente.

## Evidenza riproducibile

| Verifica | Esito | Limite della verifica |
| --- | --- | --- |
| `npm run test:filex-trial` | 43 test superati | Runtime di produzione caricato con Electron, tempo, disco e rete simulati; include avviso/chiusura/rinnovo, errori disco e risposte tardive |
| `npm run test:filex-cloud` | 36 test superati | Comprende test già inclusi nel comando precedente; i conteggi non vanno sommati come test distinti |
| `npm run test:filex-license-coverage` | Copertura dei 10 tool del catalogo | Controllo statico degli ingressi e delle policy |
| `npm run test:filex-trial-ui` | Superato | Schermate reali in Electron nascosto; servizi simulati |
| `npm run test:filex-license-emulator` | Superato | Veri emulatori Firebase Auth/Firestore locali: account, consenso, concorrenza, prova firmata, proprietà, reinstallazione, scadenza, due PC, rimborso e disattivazione |
| Typecheck desktop, cloud, Dev Console e tre tool autonomi | Superato | Non verifica gli installer distribuiti |
| `git diff --check` | Superato | Nessun errore di whitespace |
| `npm run check:git-hygiene` | Non superato | Checkout con modifiche e main avanti di un commit; nessun nuovo worktree né conflitto non risolto |

I test sono disponibili nella categoria Licenze della Dev Console. I file temporanei e le anteprime restano in `.codex-remote-attachments/`, ignorata da Git. L'emulatore usa un progetto demo isolato e viene spento al termine.

## Limiti e condizioni prima della release

1. Costruire i pacchetti reali secondo la procedura di release autorizzata, verificarne gli import runtime e provare avvio senza licenza, prova valida, abbonamento valido, scadenza a tool aperto e chiusura con elaborazioni in corso.
2. Eseguire il ciclo previsto di disinstallazione/reinstallazione su installer reali. Il codice di disinstallazione non è stato subordinato alla licenza, ma questo audit non certifica l'intero ciclo installato.
3. Collaudare email effettiva e acquisto PayPal, inclusi webhook e rimborso nell'ambiente di collaudo appropriato. I test locali non eseguono pagamenti reali.
4. Pubblicare in modo coordinato backend, configurazione Firestore, sito, Suite e tool. Le modifiche dell'audit non sono state distribuite. Gli installer precedenti non acquisiscono automaticamente le nuove protezioni.
5. Completare la verifica Git su commit pulito e allineato. Il checkout contiene modifiche precedenti, comprese quelle di Party Frame, preservate; main risultava già avanti di un commit rispetto a origin/main. Non sono stati richiesti commit, push o release.

Le verifiche offline comportano una finestra prima che una revoca remota sia rilevata. Un amministratore che modifica Windows, congela l'orologio o altera il codice Electron può attaccare i controlli locali: firme e transazioni impediscono le contraffazioni e ripetizioni verificate dai test, ma non rendono il software impossibile da crackare. Non dichiarare sicurezza assoluta né perfezione sulla base di questi test.
