import type { StoryCategory, StoryTone, StoryIntensity, StoryPlacement } from "./storyLibrary";

/**
 * Raccolta di testi per i racconti dell'album in nove temi (mani, amore, racconto, storia, emozioni, ritratti di coppia, bellezza ed essenza, fotografia, ricordo).
 * Sono coppie titolo + paragrafo scritte a mano e fornite così: il motore le tratta come le altre voci della libreria.
 */
export interface CollectionSpec {
  category: StoryCategory;
  tone: StoryTone;
  intensity: StoryIntensity;
  tags: readonly string[];
  extraPlacement?: readonly StoryPlacement[];
  pairs: ReadonlyArray<{ title: string; text: string }>;
}

export const COLLECTION_SPECS: readonly CollectionSpec[] = [
  {
    category: "mani", tone: "intimate", intensity: 2, tags: ["mani", "dettagli", "coppia", "intimita", "cerimonia"],
    pairs: [
      { title: "Dove cominciano le promesse", text: "Ci sono promesse che non hanno bisogno di parole, basta il calore di una mano che cerca un'altra mano. Nel silenzio di quel gesto trova spazio tutto ciò che conta, tutto ciò che resta, tutto ciò che ancora deve cominciare." },
      { title: "Un posto tra le dita", text: "A volte basta intrecciare le dita per ritrovare la strada di casa. Nel piccolo spazio tra una mano e l'altra si nasconde un mondo intero, fatto di attese, sorrisi e desideri capaci di attraversare il tempo." },
      { title: "La misura della tenerezza", text: "Non esiste una misura precisa per la tenerezza. Si riconosce nella delicatezza di un tocco, nella cura di un gesto, nella naturalezza con cui una mano diventa rifugio e ogni distanza trova finalmente una ragione per scomparire." },
      { title: "Senza bisogno di parlare", text: "Quando le parole si fermano, cominciano i gesti a raccontare. Una carezza, una stretta leggera, un contatto appena accennato diventano pagine silenziose di un linguaggio antico, capace di dire tutto senza pronunciare niente." },
      { title: "Il calore delle cose vere", text: "Tra le mani si raccoglie la parte più sincera dell'amore. Nessuna promessa pronunciata ad alta voce, soltanto la certezza di un contatto, il calore di una presenza e la dolcezza delle piccole cose che rendono preziosa ogni giornata." },
      { title: "Un filo invisibile", text: "Esiste un filo invisibile che unisce i gesti più semplici ai sentimenti più profondi. Si tende nelle attese, si ritrova negli abbracci e attraversa ogni stagione, senza perdere la forza di riportare sempre allo stesso luogo: accanto." },
      { title: "La bellezza di restare", text: "Tra tante strade possibili, la bellezza prende forma nella scelta di restare vicini. Mani che si cercano, passi che si accordano, piccoli gesti quotidiani che trasformano il tempo trascorso insieme in una promessa capace di rinnovarsi." },
      { title: "Tutto in una carezza", text: "In una carezza trova riparo ciò che le parole non riescono a spiegare. La dolcezza si posa sulla pelle, il mondo rallenta e, per un istante, ogni cosa ritrova la propria misura nella semplicità di un contatto." },
      { title: "Il linguaggio del cuore", text: "Esiste un linguaggio senza voce, scritto attraverso le dita e custodito nella memoria della pelle. Ogni gesto lascia una traccia, ogni incontro aggiunge una parola, ogni carezza compone una poesia destinata a non perdere significato." },
      { title: "Finché ci sarà una mano", text: "Tra le promesse più grandi abitano i gesti più piccoli. Una mano tesa, una stretta sincera, un contatto ritrovato dopo una lunga giornata: da queste semplici cose nasce la forza discreta di un amore che continua." },
    ],
  },
  {
    category: "amore", tone: "elegant", intensity: 3, tags: ["coppia", "ritratto", "cerimonia", "universali"],
    pairs: [
      { title: "Tutto quello che conta", text: "Alla fine, tra mille desideri e infinite strade, resta la bellezza di condividere il cammino. Il resto diventa rumore lontano, mentre acquistano valore gli sguardi sinceri, le risate improvvise e la pace di sentirsi nel posto giusto." },
      { title: "Una forma di infinito", text: "L'infinito non ha sempre bisogno di cieli immensi o distanze senza confini. A volte prende forma in una promessa, in un sorriso condiviso, nella voglia di ritrovarsi ancora domani e di chiamare futuro ogni nuovo giorno insieme." },
      { title: "La scelta più bella", text: "L'amore non vive soltanto nei momenti straordinari, ma nella libertà di scegliersi ogni giorno. Nella pazienza, nella complicità, nella capacità di attraversare il tempo senza smarrire la meraviglia del primo incontro." },
      { title: "Un mondo dentro un abbraccio", text: "Basta un abbraccio per mettere a tacere la fretta del mondo. Tutto trova riparo in uno spazio piccolo, ma abbastanza grande da contenere sogni, paure, speranze e quella dolce certezza che rende meno lontano qualsiasi domani." },
      { title: "La felicità senza rumore", text: "La felicità più autentica non sempre fa rumore. A volte abita una tavola apparecchiata, una passeggiata senza meta, una risata che arriva all'improvviso. Piccole scene di vita capaci di diventare, con il tempo, i ricordi più grandi." },
      { title: "Ogni giorno una promessa", text: "Una promessa d'amore non appartiene soltanto a un giorno speciale. Si rinnova nei gesti di ogni mattina, nella pazienza delle attese e nella dolcezza dei ritorni, fino a trasformare il tempo in una lunga dichiarazione di presenza." },
      { title: "La distanza più breve", text: "Tra due cuori, la distanza più breve non si misura in passi. Si misura nella fiducia, nella complicità, nella libertà di mostrarsi senza difese. È in questo spazio invisibile che nasce la possibilità di sentirsi davvero vicini." },
      { title: "Il posto del cuore", text: "Ogni viaggio custodisce una destinazione capace di dare significato alla strada. Nell'amore, quella destinazione prende forma nella condivisione: un luogo da costruire insieme, una casa fatta di gesti, una certezza da ritrovare anche lontano." },
      { title: "Oltre le parole", text: "Ci sono sentimenti che superano ogni definizione. Non entrano in una frase, non si lasciano spiegare fino in fondo. Si riconoscono nella luce degli occhi, nella delicatezza dei gesti e nella naturalezza con cui due vite imparano a camminare insieme." },
      { title: "La meraviglia di scegliersi", text: "La meraviglia non consiste nel trovare una strada senza ostacoli, ma nel desiderare ancora la stessa direzione. Ogni passo condiviso aggiunge una pagina, ogni difficoltà insegna una nuova forma di fiducia, ogni ritorno ricorda il valore della scelta." },
    ],
  },
  {
    category: "racconto", tone: "editorial", intensity: 2, tags: ["universali", "dettagli", "sequenza"],
    pairs: [
      { title: "Una pagina alla volta", text: "Ogni storia merita pagine capaci di custodirne la verità. Un sorriso, una lacrima, un abbraccio inatteso: dettagli apparentemente piccoli che, messi insieme, compongono il racconto più prezioso, quello di un giorno vissuto senza risparmiare emozioni." },
      { title: "Le parole della luce", text: "La luce possiede una lingua tutta sua. Accarezza i volti, disegna i contorni, rivela dettagli che spesso sfuggono allo sguardo. Attraverso la fotografia, ogni riflesso diventa parola e ogni immagine trova il modo di raccontare." },
      { title: "Il filo del racconto", text: "Un racconto autentico non segue sempre una linea perfetta. Si compone di attimi improvvisi, sorrisi fuori programma e abbracci che arrivano senza essere annunciati. Proprio nelle imperfezioni trova la propria voce e diventa memoria." },
      { title: "Tutto trova posto", text: "In un racconto sincero c'è spazio per ogni emozione. Per la gioia che esplode, per la commozione che sorprende, per la leggerezza di un sorriso. Nessun frammento è troppo piccolo quando contribuisce a raccontare ciò che conta davvero." },
      { title: "La trama dei ricordi", text: "La memoria intreccia momenti diversi come fili dello stesso tessuto. Un incontro, una promessa, una risata lontana si legano in una trama invisibile, destinata a diventare più preziosa ogni volta che il tempo invita a ricordare." },
      { title: "Il racconto degli sguardi", text: "Prima delle parole, spesso cominciano gli sguardi. Si cercano tra la folla, si fermano per un istante, si illuminano di significati che appartengono soltanto a chi sa riconoscerli. Da quel silenzio nasce una storia intera." },
      { title: "Una storia da sfogliare", text: "Ogni pagina custodisce un frammento di vita, ogni fotografia apre una porta, ogni dettaglio restituisce una sensazione. Sfogliare un album significa tornare dentro il racconto, riscoprendo la bellezza di ciò che è stato vissuto." },
      { title: "Il valore dei dettagli", text: "Le storie più belle si nascondono spesso nei particolari. Un bottone sistemato con cura, un sorriso trattenuto, una mano appoggiata sulla spalla. Piccoli segni che restituiscono autenticità al racconto e trasformano un'immagine in un ricordo vivo." },
      { title: "Un capitolo di felicità", text: "Tra le pagine della vita esistono capitoli destinati a occupare un posto speciale. Giorni in cui tutto sembra trovare una propria armonia, tra emozioni sincere e promesse luminose. Un capitolo da custodire, senza fretta di voltare pagina." },
      { title: "La storia continua", text: "Nessun album può contenere un'intera vita, ma può custodire l'inizio di qualcosa di meraviglioso. Ogni immagine trattiene una traccia del cammino e lascia spazio alle pagine ancora bianche, pronte ad accogliere nuovi sogni e nuovi ricordi." },
    ],
  },
  {
    category: "storia", tone: "reflective", intensity: 3, tags: ["universali", "incontro", "coppia"], extraPlacement: ["section_intro"],
    pairs: [
      { title: "Da qualche parte, un inizio", text: "Ogni storia importante comincia molto prima di essere riconosciuta. Un incontro casuale, una parola inattesa, un momento apparentemente ordinario possono diventare il primo passo verso qualcosa di capace di cambiare il significato delle giornate." },
      { title: "Il tempo delle cose belle", text: "Esiste un tempo speciale per ogni cosa: quello degli incontri, delle attese, delle promesse mantenute. Non segue sempre l'orologio, ma il ritmo delle emozioni. Ed è proprio in questo tempo che nascono i ricordi destinati a restare." },
      { title: "Le strade che si incontrano", text: "Due strade possono attraversare paesaggi diversi prima di trovare un punto d'incontro. Da quel momento il cammino acquista nuove prospettive, nuovi orizzonti e la possibilità di trasformare ogni destinazione in un'esperienza condivisa." },
      { title: "Un destino fatto di piccoli passi", text: "A volte il destino non arriva con grandi segnali. Si manifesta attraverso coincidenze, incontri ripetuti e scelte apparentemente semplici. Un passo dopo l'altro, il caso lascia spazio alla consapevolezza e prende forma una storia tutta da vivere." },
      { title: "Il giorno da ricordare", text: "Ci sono giorni che meritano un posto speciale nella memoria. Giorni capaci di raccogliere attese, emozioni e desideri in un unico abbraccio. Il loro valore non si esaurisce con il tramonto, ma continua a vivere in ogni ricordo." },
      { title: "Prima che diventi memoria", text: "Ogni istante attraversa il presente con una delicatezza che spesso passa inosservata. Soltanto dopo, quando il tempo avanza, emerge la sua vera importanza. Per questo vale la pena fermarsi, osservare e dare valore a ciò che accade." },
      { title: "Il tempo dalla nostra parte", text: "Il tempo non cancella sempre le tracce: a volte insegna a riconoscerne il valore. Un ricordo diventa più profondo, una fotografia acquista nuove sfumature, un momento del passato torna a illuminare il presente con una dolcezza inaspettata." },
      { title: "Le pagine ancora bianche", text: "Ogni inizio porta con sé pagine senza parole e orizzonti ancora da scoprire. Nessuna certezza sul percorso, soltanto la bellezza di avere qualcosa da costruire e il desiderio di lasciare spazio alle sorprese della vita." },
      { title: "Una storia, mille ritorni", text: "Le storie più preziose non finiscono con l'ultima pagina. Continuano nei gesti quotidiani, nei racconti condivisi e nelle fotografie sfogliate durante una sera tranquilla. Ogni ritorno aggiunge un significato nuovo a ciò che il cuore conserva." },
      { title: "Il senso del viaggio", text: "Non conta soltanto la destinazione, ma la bellezza di tutto ciò che accade lungo il percorso. Le risate improvvise, le deviazioni inattese, gli abbracci nei momenti difficili: frammenti che trasformano un viaggio in una storia degna di essere ricordata." },
    ],
  },
  {
    category: "emozioni", tone: "poetic", intensity: 4, tags: ["spontaneita", "cerimonia", "festa", "famiglia"],
    pairs: [
      { title: "Quando il cuore sorride", text: "Esistono sorrisi che nascono prima di qualsiasi pensiero. Arrivano leggeri, illuminano il viso e trasformano un momento semplice in qualcosa di indimenticabile. La felicità autentica non ha bisogno di essere cercata lontano: spesso si manifesta proprio davanti agli occhi." },
      { title: "Una lacrima di luce", text: "A volte la gioia trova la strada attraverso una lacrima. Un'emozione troppo grande per restare nascosta, una promessa che prende forma, un abbraccio capace di sciogliere ogni attesa. Anche la commozione possiede una bellezza tutta sua." },
      { title: "Il battito del momento", text: "Ci sono istanti in cui il tempo sembra rallentare. Il respiro cambia ritmo, lo sguardo si fa più intenso e ogni dettaglio acquista una luce diversa. Sono momenti fragili e preziosi, impossibili da programmare e indimenticabili da rivivere." },
      { title: "La gioia senza copione", text: "La felicità più bella arriva senza prove e senza copione. Si nasconde nelle risate incontrollate, negli abbracci improvvisi, nei gesti che sorprendono. Proprio questa spontaneità rende ogni emozione autentica e ogni fotografia diversa da tutte le altre." },
      { title: "Tutto quello che si sente", text: "Non tutte le emozioni trovano parole adeguate. Alcune rimangono negli occhi, altre tremano in un sorriso, altre ancora si raccolgono nel silenzio di un abbraccio. La fotografia permette a ogni sfumatura di trovare uno spazio in cui restare." },
      { title: "La pelle dei ricordi", text: "I ricordi più intensi sembrano avere una consistenza. Una voce che ritorna alla mente, il calore di un abbraccio, una risata riconoscibile tra mille. La memoria conserva sensazioni invisibili, capaci di riportare il passato vicino al presente." },
      { title: "Il coraggio di sentire", text: "Ogni emozione autentica porta con sé una forma di coraggio. La libertà di sorridere senza misura, di commuoversi senza difese, di lasciarsi sorprendere dalla bellezza di un momento. Vivere davvero significa concedere spazio a tutto ciò che si sente." },
      { title: "Un istante di meraviglia", text: "La meraviglia arriva quando lo sguardo incontra qualcosa di capace di fermare la fretta. Una luce particolare, un gesto gentile, una presenza amata. Per un attimo il mondo sembra più semplice e la felicità trova una forma da ricordare." },
      { title: "Le emozioni non passano invano", text: "Ogni emozione lascia una traccia, anche quando il momento sembra troppo breve per essere importante. La gioia si trasforma in sorriso, la commozione diventa memoria e l'attesa acquista significato. Nulla di autentico attraversa la vita senza lasciare qualcosa." },
      { title: "La bellezza di essere veri", text: "Non occorre cercare la perfezione quando la verità possiede già una propria bellezza. Un sorriso spontaneo, uno sguardo imperfetto, un gesto inatteso raccontano molto più di qualsiasi posa studiata. È nella libertà di essere autentici che nasce la magia." },
    ],
  },
  {
    category: "ritratti_coppia", tone: "intimate", intensity: 3, tags: ["ritratto", "coppia", "intimita"],
    pairs: [
      { title: "Nel mezzo di un abbraccio", text: "Nel mezzo di un abbraccio il mondo perde per un momento ogni urgenza. Restano il calore, la vicinanza e la sensazione di appartenere a un istante irripetibile. Tutto il resto può aspettare, mentre la bellezza trova il proprio centro." },
      { title: "La stessa direzione", text: "Camminare nella stessa direzione non significa avere sempre gli stessi passi. Significa riconoscere un orizzonte comune, rispettare le distanze necessarie e ritrovare, anche dopo ogni curva, il desiderio di proseguire insieme." },
      { title: "Intesa senza parole", text: "L'intesa più profonda si riconosce prima ancora di essere spiegata. In uno sguardo complice, in un sorriso accennato, nella naturalezza di un gesto condiviso. Un linguaggio discreto che trasforma la vicinanza in una forma speciale di libertà." },
      { title: "Due respiri, una sola luce", text: "Ci sono incontri capaci di cambiare il modo di guardare il mondo. La luce sembra più morbida, il tempo meno frettoloso e ogni paesaggio acquista un significato nuovo. La bellezza di un ritratto nasce proprio da questa armonia." },
      { title: "La dolcezza della vicinanza", text: "La vicinanza non ha bisogno di grandi gesti per essere riconosciuta. Basta una spalla cercata, una fronte sfiorata, un sorriso nato per caso. In questi piccoli dettagli prende forma un'intimità capace di raccontare molto più di mille parole." },
      { title: "Il mondo fuori fuoco", text: "Quando lo sguardo si ferma sulla persona amata, tutto il resto può diventare sfondo. I rumori si allontanano, la fretta perde importanza e l'istante acquista una profondità nuova. Rimane la bellezza di esserci, senza bisogno di altro." },
      { title: "Il ritmo di due cuori", text: "Ogni coppia possiede un ritmo irripetibile, fatto di passi veloci e pause lente, di sorrisi condivisi e silenzi pieni di significato. Fotografare questa armonia significa cercare la musica nascosta nei gesti e trasformarla in immagini." },
      { title: "La nostra piccola eternità", text: "L'eternità, a volte, dura il tempo di uno sguardo. Un abbraccio che sembra sospendere il mondo, una risata che riempie l'aria, un istante in cui ogni cosa trova il proprio posto. Piccole eternità da conservare oltre il passare degli anni." },
      { title: "Vicini, senza fretta", text: "Non serve correre quando il momento merita di essere vissuto lentamente. Basta avvicinarsi, ritrovare un sorriso e lasciare che la luce accompagni ogni gesto. Nella calma della vicinanza nasce un ritratto capace di restituire la verità di un legame." },
      { title: "L'arte di appartenersi", text: "Appartenersi non significa trattenere, ma riconoscere uno spazio in cui sentirsi liberi. Significa condividere sogni senza spegnerne altri, camminare accanto senza perdere la propria strada e trovare nella complicità una nuova forma di bellezza." },
    ],
  },
  {
    category: "bellezza", tone: "elegant", intensity: 2, tags: ["ritratto", "sposa", "preparativi", "dettagli"],
    pairs: [
      { title: "Oltre lo specchio", text: "La bellezza più interessante non si ferma alla superficie. Vive nei dettagli dello sguardo, nella naturalezza di un sorriso, nella sicurezza di un gesto. Oltre lo specchio esiste un universo personale che merita di essere raccontato senza filtri." },
      { title: "L'essenza delle cose", text: "Ogni persona custodisce un'essenza impossibile da racchiudere in una sola definizione. Si manifesta nei gesti spontanei, nella delicatezza di un'espressione, nella forza di uno sguardo. Un ritratto autentico nasce quando l'immagine incontra qualcosa di vero." },
      { title: "La luce che appartiene", text: "Ogni volto possiede una luce particolare, capace di emergere in un momento preciso. A volte è intensa, altre volte appena accennata, ma sempre personale. Riconoscerla significa dare spazio alla bellezza senza imporle una forma." },
      { title: "La grazia dell'imperfezione", text: "La perfezione cerca linee impeccabili, ma la bellezza spesso abita altrove. In una ciocca fuori posto, in un sorriso asimmetrico, in un'espressione inattesa. L'imperfezione aggiunge carattere, rende un'immagine umana e le permette di restare nella memoria." },
      { title: "Un volto, mille sfumature", text: "Un volto può custodire mondi diversi. La dolcezza di un sorriso, la forza di uno sguardo, la leggerezza di un'espressione inattesa raccontano sfumature che nessuna descrizione potrebbe esaurire. Ogni ritratto diventa una scoperta, ogni dettaglio una nuova prospettiva." },
      { title: "La bellezza di sentirsi", text: "Esiste una bellezza che nasce dalla libertà di sentirsi a proprio agio. Non richiede pose perfette, ma spazio per respirare, sorridere e lasciarsi sorprendere. È la bellezza della naturalezza, quando l'immagine smette di cercare approvazione e comincia a raccontare." },
      { title: "L'eleganza del silenzio", text: "Il silenzio può possedere un'eleganza rara. Si manifesta in uno sguardo raccolto, in una postura naturale, nella calma di un'espressione che non ha bisogno di spiegarsi. Un ritratto essenziale lascia parlare la presenza e affida alla luce il compito di completare il racconto." },
      { title: "La forza della delicatezza", text: "La delicatezza non è assenza di forza, ma una forza capace di esprimersi senza alzare la voce. Vive nei gesti misurati, nella gentilezza dello sguardo e nella sicurezza di chi non ha bisogno di nascondere la propria sensibilità." },
      { title: "Un modo unico di brillare", text: "Ogni persona possiede un modo irripetibile di brillare. A volte attraverso l'energia di un sorriso, altre nella profondità di uno sguardo, altre ancora nella tranquillità di una presenza discreta. La fotografia non crea questa luce: la riconosce e la custodisce." },
      { title: "La verità di un ritratto", text: "Un ritratto riesce davvero quando non si limita a mostrare un volto, ma lascia intuire una personalità. Dietro ogni espressione esiste una storia, dietro ogni gesto una sfumatura. La verità dell'immagine nasce proprio da ciò che non ha bisogno di essere recitato." },
    ],
  },
  {
    category: "fotografia", tone: "cinematic", intensity: 2, tags: ["universali", "dettagli", "luce"],
    pairs: [
      { title: "Fermare la luce", text: "La luce attraversa ogni giornata senza chiedere di essere ricordata. Cambia colore, disegna forme e scompare con la stessa naturalezza con cui arriva. La fotografia nasce dal desiderio di trattenerne una traccia, trasformando un passaggio fugace in qualcosa da custodire." },
      { title: "Un secondo per sempre", text: "Basta un secondo per cambiare il destino di un'immagine. Un sorriso appena accennato, una lacrima inattesa, uno sguardo che incontra un altro sguardo. Il tempo continua a scorrere, ma quell'istante trova un modo speciale per rimanere." },
      { title: "La magia dell'attimo", text: "La fotografia più bella non sempre nasce da una scena preparata. A volte arriva all'improvviso, quando le emozioni superano ogni previsione e la realtà regala un momento irripetibile. È in quell'attimo che la tecnica incontra la sensibilità e diventa racconto." },
      { title: "La luce dei ricordi", text: "Ogni fotografia custodisce una luce che va oltre quella presente nella scena. È la luce di un giorno speciale, di un sorriso sincero, di una presenza importante. Con il passare degli anni, l'immagine continua a illuminare il ricordo con nuove sfumature." },
      { title: "Un'immagine, mille ritorni", text: "Una fotografia non conduce mai soltanto a un momento del passato. Riporta alle sensazioni, ai suoni immaginati, alle persone e ai dettagli che il tempo rischia di confondere. Ogni sguardo rivolto all'immagine diventa un nuovo viaggio dentro la memoria." },
      { title: "L'invisibile dentro l'immagine", text: "Dietro ogni fotografia esiste qualcosa che non compare nell'inquadratura. L'attesa prima dello scatto, il battito accelerato, la felicità condivisa, il significato di un gesto. La forza di un'immagine risiede anche in tutto ciò che riesce a evocare senza mostrarlo." },
      { title: "La poesia della luce", text: "La luce scrive senza inchiostro e disegna senza lasciare segni permanenti. Si posa sui volti, accarezza i tessuti e trasforma gli spazi più semplici in scenari pieni di significato. Fotografare significa imparare ad ascoltare questa poesia silenziosa." },
      { title: "Oltre lo scatto", text: "Uno scatto dura una frazione di secondo, ma il suo valore può attraversare intere generazioni. Quando la luce incontra un'emozione autentica, l'immagine diventa qualcosa di più di una fotografia: diventa una testimonianza della vita vissuta." },
      { title: "Il mestiere di ricordare", text: "Fotografare significa assumersi il compito delicato di custodire ciò che passa. Non soltanto volti e paesaggi, ma emozioni, legami e dettagli destinati a cambiare significato nel tempo. Un lavoro di attenzione che trasforma il presente in memoria." },
      { title: "Quando il tempo si ferma", text: "Il tempo non si ferma davvero, ma una fotografia può regalare questa sensazione. Per un istante tutto rimane al proprio posto: la luce, il sorriso, la vicinanza. E anche quando gli anni cambiano ogni cosa, quell'immagine continua a custodire il momento." },
    ],
  },
  {
    category: "ricordo", tone: "reflective", intensity: 3, tags: ["finale", "universali", "coppia"], extraPlacement: ["closing"],
    pairs: [
      { title: "Per non dimenticare", text: "Non si fotografa soltanto per ricordare ciò che è accaduto, ma per ritrovare ciò che quel momento ha significato. Una fotografia diventa un ponte tra il presente e il passato, capace di restituire emozioni anche quando i dettagli iniziano a sfumare." },
      { title: "Quando tornerà il tempo", text: "Un giorno, queste pagine verranno sfogliate con occhi diversi. Alcuni dettagli faranno sorridere, altri riporteranno una dolce nostalgia. Il tempo avrà cambiato le abitudini e i paesaggi, ma resterà la possibilità di tornare, attraverso le immagini, a ciò che ha reso speciale quel giorno." },
      { title: "La memoria ha una casa", text: "La memoria ha bisogno di luoghi in cui ritrovare le proprie storie. Un album aperto sul tavolo, una fotografia incorniciata, una pagina mostrata a chi non c'era. Sono piccoli spazi in cui i ricordi continuano a vivere e a trovare nuove voci." },
      { title: "Ciò che resta", text: "Quando le luci si spengono e la festa diventa un ricordo, rimane il valore delle emozioni condivise. Restano i gesti, le promesse, le persone amate e le immagini capaci di ricomporre ogni frammento. La bellezza di un giorno non finisce con il suo ultimo istante." },
      { title: "Un'eredità di emozioni", text: "Le fotografie attraversano le generazioni portando con sé qualcosa di più dei volti. Raccontano legami, tradizioni, modi di sorridere e di volersi bene. Diventano un'eredità silenziosa, capace di far incontrare il passato con chi ancora deve arrivare." },
      { title: "Il futuro sfoglia il passato", text: "Ogni album custodisce un incontro tra tempi diversi. Nel presente nasce l'immagine, nel futuro prende forma il ricordo. Tra queste due dimensioni vive il valore della fotografia: la possibilità di lasciare una traccia autentica di ciò che ha reso significativa una giornata." },
      { title: "Per tutte le volte che verrà", text: "Un ricordo prezioso non appartiene a una sola occasione. Può essere ritrovato nei giorni felici, nei momenti di nostalgia e nelle serate in cui nasce il desiderio di tornare indietro. Ogni fotografia offre una nuova possibilità di sentire, ancora una volta, la bellezza di ciò che è stato." },
      { title: "Le cose che non invecchiano", text: "Il tempo cambia i volti, trasforma i luoghi e aggiunge nuove pagine alla vita. Eppure alcuni gesti conservano una freschezza particolare, alcuni sorrisi mantengono la stessa luce, alcune emozioni sembrano non invecchiare mai. È questa la meraviglia dei ricordi custoditi bene." },
      { title: "Una vita da sfogliare", text: "Tra queste pagine non trovano posto soltanto immagini, ma frammenti di una vita. Ogni fotografia racconta un incontro, una stagione, una promessa o una scoperta. Sfogliare un album significa riconoscere il cammino compiuto e ritrovare la bellezza nascosta nelle cose vissute." },
      { title: "Per sempre, in una pagina", text: "Ci sono momenti che meritano uno spazio tutto loro, lontano dalla fretta dei giorni. Una pagina in cui ritrovare la luce, le emozioni e la verità di un istante. Perché il tempo può continuare a scrivere nuove storie, ma alcuni ricordi meritano di rimanere per sempre." },
    ],
  },
];
