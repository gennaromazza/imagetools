/**
 * Libreria editoriale narrativa per gli album di matrimonio: testi scritti per accompagnare le foto come uno storytelling,
 * né in prima persona, né dalla voce degli sposi o del fotografo, né come didascalia di ciò che si vede.
 *
 * Ogni voce è una unità con metadati (categoria, tipo, lunghezza, tono, intensità, abbinamenti e posizioni consigliate) che il motore
 * di selezione (`story.ts`) usa per scegliere il testo giusto per la pagina, invece di pescarne uno a caso.
 * Per estenderla basta aggiungere voci agli elenchi di `SPECS`: gli identificativi si compongono da soli (categoria, genere, numero
 * d'ordine), quindi le voci nuove vanno sempre in coda a ciascun elenco per non cambiare quelli esistenti.
 */

export const STORY_CATEGORIES = [
  "aperture", "preparativi", "casa", "famiglia", "amici", "attesa", "incontro", "cerimonia", "sguardi", "ritratto_coppia",
  "intimita", "dettagli", "invitati", "ricevimento", "festa", "spontaneita", "tramonto", "notte", "finale",
  "universali", "poetici", "microcopy", "cinematografici", "chiusure", "citazioni",
] as const;
export type StoryCategory = (typeof STORY_CATEGORIES)[number];

export const STORY_TYPES = ["title", "microcopy", "short", "medium", "long", "quote"] as const;
export type StoryType = (typeof STORY_TYPES)[number];

export const STORY_LENGTHS = ["micro", "short", "medium", "long"] as const;
export type StoryLength = (typeof STORY_LENGTHS)[number];

export const STORY_TONES = ["editorial", "cinematic", "poetic", "intimate", "elegant", "reflective", "celebratory", "minimal"] as const;
export type StoryTone = (typeof STORY_TONES)[number];

export const STORY_PLACEMENTS = ["opening", "section_intro", "full_page", "double_page", "text_block", "closing", "image_overlay", "small_space"] as const;
export type StoryPlacement = (typeof STORY_PLACEMENTS)[number];

/** 1 = molto delicato, 2 = delicato, 3 = emozionale, 4 = intenso, 5 = molto intenso. */
export type StoryIntensity = 1 | 2 | 3 | 4 | 5;

export interface StoryUnit {
  id: string;
  category: StoryCategory;
  type: StoryType;
  /** Presente nei titoli e nelle unità «titolo + paragrafo». */
  title?: string;
  /** Presente in tutto tranne i titoli soli. A capo con `\n`. */
  text?: string;
  length: StoryLength;
  tone: StoryTone;
  emotionalIntensity: StoryIntensity;
  /** Tipi di foto o di sequenze per cui il testo è adatto («preparativi», «ritratto», «dettagli»…). */
  recommendedFor: readonly string[];
  placement: readonly StoryPlacement[];
  /** Falso solo per le citazioni d'autore. */
  original: boolean;
  /** Valorizzato solo nelle citazioni: le frasi originali non hanno autore. */
  author: string | null;
  /** Citazioni: la fonte non è stata verificata, quindi non entrano mai nei suggerimenti automatici (solo a scelta manuale). */
  needsSourceCheck?: boolean;
}

export const STORY_CATEGORY_LABEL: Record<StoryCategory, string> = {
  aperture: "Aperture", preparativi: "Preparativi", casa: "La casa", famiglia: "Famiglia", amici: "Amici", attesa: "L'attesa",
  incontro: "L'incontro", cerimonia: "La cerimonia", sguardi: "Gli sguardi", ritratto_coppia: "Ritratto di coppia", intimita: "Intimità",
  dettagli: "Dettagli", invitati: "Gli invitati", ricevimento: "Il ricevimento", festa: "La festa", spontaneita: "Spontaneità",
  tramonto: "Tramonto", notte: "La notte", finale: "Finale", universali: "Universali", poetici: "Poetici", microcopy: "Parole brevi",
  cinematografici: "Cinematografici", chiusure: "Chiusure", citazioni: "Citazioni d'autore",
};

export const STORY_TYPE_LABEL: Record<StoryType, string> = {
  title: "Titolo", microcopy: "Parola breve", short: "Testo breve", medium: "Testo medio", long: "Testo lungo", quote: "Citazione",
};

export const STORY_LENGTH_LABEL: Record<StoryLength, string> = { micro: "Brevissimo", short: "Breve", medium: "Medio", long: "Lungo" };

export const STORY_TONE_LABEL: Record<StoryTone, string> = {
  editorial: "Editoriale", cinematic: "Cinematografico", poetic: "Poetico", intimate: "Intimo", elegant: "Elegante",
  reflective: "Riflessivo", celebratory: "Di festa", minimal: "Essenziale",
};

export const STORY_INTENSITY_LABEL: Record<StoryIntensity, string> = { 1: "Molto delicato", 2: "Delicato", 3: "Emozionale", 4: "Intenso", 5: "Molto intenso" };

/** Lunghezza dal testo: la stessa regola per tutte le voci, così il motore sa quanto spazio chiedono. */
export function lengthOfText(text: string): StoryLength {
  const size = text.replace(/\s+/g, " ").trim().length;
  if (size <= 32) return "micro";
  if (size <= 130) return "short";
  if (size <= 300) return "medium";
  return "long";
}

/** Chiave per riconoscere lo stesso testo anche se cambia la maiuscola o la spaziatura. */
export function storyKey(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Dati
// ---------------------------------------------------------------------------

interface Spec {
  category: StoryCategory;
  tone: StoryTone;
  intensity: StoryIntensity;
  tags: readonly string[];
  /** Posizioni in più rispetto a quelle dedotte da tipo e lunghezza. */
  extraPlacement?: readonly StoryPlacement[];
  titles?: readonly string[];
  short?: readonly string[];
  medium?: readonly string[];
  long?: readonly string[];
  /** Testi senza etichetta: la lunghezza si deduce. */
  texts?: readonly string[];
  /** Titolo e paragrafo che vanno sempre insieme. `tags` per voce sostituisce quelli della categoria. */
  pairs?: ReadonlyArray<{ title: string; text: string; tags?: readonly string[]; extraPlacement?: readonly StoryPlacement[] }>;
}

const SPECS: readonly Spec[] = [
  {
    category: "aperture", tone: "cinematic", intensity: 2, tags: ["opening", "preparativi", "casa", "dettagli", "luogo", "paesaggio"], extraPlacement: ["opening", "section_intro"],
    titles: ["Prima che tutto cominci", "L'inizio di qualcosa", "Il giorno prende forma", "Prima del primo passo", "Quando il tempo rallenta", "Un giorno da attraversare", "Tutto comincia qui", "L'attesa", "Il giorno che arriva", "Prima che accada", "Una storia ancora da raccontare", "Le prime pagine", "Il tempo dell'attesa", "L'inizio", "Quel giorno"],
    short: [
      "Ogni storia ha un momento in cui ancora non è successo nulla, eppure tutto è già cominciato.",
      "Prima degli abbracci, delle promesse e della festa, esiste un tempo fatto soltanto di attesa.",
      "Il giorno arriva lentamente. Prima entra nelle stanze, poi nei gesti, infine negli occhi.",
      "Ci sono giorni che sembrano uguali agli altri fino a quando qualcosa, quasi impercettibilmente, cambia.",
    ],
    medium: [
      "Ci sono giorni che non hanno bisogno di essere annunciati. Arrivano piano, modificano il ritmo delle cose e trasformano anche i gesti più semplici in qualcosa da ricordare.",
      "Prima che il mondo se ne accorga, una giornata speciale comincia sempre dalle piccole cose. Una porta che si apre, una voce dall'altra stanza, mani che sistemano gli ultimi dettagli. Il resto arriverà dopo.",
    ],
    long: [
      "Prima che tutto cominci davvero, esiste un tempo sospeso.\nLe stanze sono ancora quelle di sempre, le persone si muovono seguendo gesti conosciuti, il mondo continua fuori dalle finestre.\nEppure qualcosa è diverso.\n\nÈ l'attesa.\nQuella sensazione difficile da spiegare in cui ogni minuto sembra custodire qualcosa che sta per accadere.",
    ],
    pairs: [
      { title: "Prima che tutto cominci", text: "Ci sono giorni che arrivano senza fare rumore.\nPoi, lentamente, cambiano il ritmo delle stanze, il modo in cui ci si guarda, il significato delle cose più semplici.\nUna camicia appesa alla porta. Un abito ancora dentro la sua custodia. Le mani che cercano gli ultimi dettagli.\n\nFuori, il mondo continua come sempre.\nQui dentro, invece, qualcosa sta per cambiare." },
    ],
  },
  {
    category: "preparativi", tone: "editorial", intensity: 2, tags: ["preparativi", "dettagli", "abito", "casa", "ritratto"],
    titles: ["I dettagli dell'attesa", "Le mani", "Prima di uscire", "Gli ultimi dettagli", "Tutto al proprio posto", "Prepararsi al giorno", "Dentro casa", "Il tempo dei preparativi", "Piccoli rituali", "Prima dello specchio", "Le cose che precedono", "Mentre il giorno cresce"],
    short: [
      "Le mani raccontano spesso ciò che le parole non riescono a dire.",
      "Ogni dettaglio trova lentamente il proprio posto.",
      "Il giorno comincia anche così: nei piccoli gesti che nessuno aveva previsto di ricordare.",
      "Un ultimo controllo, un sorriso, una porta che si chiude. E il momento arriva.",
    ],
    texts: [
      "Ci sono gesti che appartengono alla quotidianità e che, proprio quel giorno, acquistano un significato diverso.",
      "Attorno a loro tutto si muove. Qualcuno cerca qualcosa, qualcuno sistema, qualcuno osserva in silenzio. Nel centro di quel piccolo caos, il giorno prende lentamente forma.",
    ],
    pairs: [
      { title: "I dettagli dell'attesa", text: "Una giornata così importante non comincia con un grande gesto. Comincia dalle piccole cose: un abito sistemato, una cravatta stretta, un bottone controllato due volte." },
    ],
  },
  {
    category: "casa", tone: "reflective", intensity: 2, tags: ["casa", "preparativi", "dettagli", "famiglia", "luogo"],
    titles: ["Casa", "Dove tutto comincia", "Le stanze della memoria", "Prima di andare", "Il luogo delle origini", "Dentro casa", "Quello che resta", "Le cose di sempre"],
    texts: [
      "Prima di diventare un ricordo, ogni giornata speciale attraversa luoghi familiari.",
      "Le case custodiscono una parte invisibile delle persone. Oggetti, fotografie, stanze, gesti ripetuti per anni. In un giorno come questo, tutto sembra raccontare qualcosa.",
      "Ci sono luoghi che non hanno bisogno di essere fotografati per essere ricordati. Basta sapere che, quel giorno, tutto è cominciato lì.",
      "La casa si riempie lentamente di rumori.\nUna porta che si apre, una voce dall'altra stanza, mani che sistemano gli ultimi dettagli.\nFuori, il giorno è già cominciato. Dentro, invece, tutto sembra aspettare quel momento preciso in cui ogni cosa prenderà il proprio posto.",
    ],
  },
  {
    category: "famiglia", tone: "intimate", intensity: 3, tags: ["famiglia", "ritratto", "invitati", "abbracci"],
    titles: ["Le persone di sempre", "Le radici", "Accanto", "Da dove si viene", "La famiglia", "Le presenze", "Quelli che c'erano", "Insieme", "Le mani che accompagnano"],
    short: [
      "Alcune presenze fanno parte della storia molto prima che questa giornata cominci.",
      "Ci sono abbracci che contengono anni.",
      "La famiglia è anche questo: esserci quando arriva il momento importante.",
      "Alcuni sguardi conoscono una storia intera.",
    ],
    medium: [
      "In una giornata che parla di futuro, la famiglia porta con sé tutto ciò che viene prima. Ricordi, sacrifici, risate, assenze e presenze che hanno accompagnato il cammino fino a qui.",
      "Non serve raccontare tutto. Alcune storie sono già scritte nei gesti, nella familiarità di uno sguardo, nel modo in cui una mano cerca un'altra mano.",
    ],
  },
  {
    category: "amici", tone: "celebratory", intensity: 2, tags: ["amici", "invitati", "festa", "spontaneita"],
    titles: ["Quelli che sanno", "La parte rumorosa", "Complici", "Gli amici", "Sempre loro", "Le risate", "Fuori programma", "Insieme, come sempre"],
    texts: [
      "Gli amici hanno il raro talento di trasformare anche una giornata perfettamente organizzata in qualcosa di completamente imprevedibile.",
      "Ci sono persone che non hanno bisogno di spiegazioni. Basta uno sguardo e una risata arriva prima delle parole.",
      "In mezzo alla perfezione del giorno, gli amici portano quello che non può essere programmato: spontaneità.",
    ],
  },
  {
    category: "attesa", tone: "cinematic", intensity: 3, tags: ["attesa", "preparativi", "cerimonia", "ritratto"],
    titles: ["Ancora un momento", "Prima di incontrarsi", "L'attesa", "Un respiro prima", "Separati solo per un istante", "Ancora pochi passi", "Prima dello sguardo"],
    short: [
      "Ancora pochi minuti.",
      "Prima di vedersi, ci si immagina.",
      "A volte l'attesa è già parte dell'incontro.",
      "Tutto ciò che accade dopo passa, per un istante, attraverso questo silenzio.",
    ],
    medium: [
      "C'è un momento, poco prima dell'incontro, in cui tutto sembra fermarsi. Le voci diventano lontane, i gesti più lenti, il tempo quasi immobile. È l'ultimo istante prima che la giornata cambi ritmo.",
    ],
  },
  {
    category: "incontro", tone: "cinematic", intensity: 4, tags: ["incontro", "sguardi", "coppia", "cerimonia"],
    titles: ["Finalmente", "Il primo sguardo", "Eccoti", "Quando gli occhi si incontrano", "Il momento", "Davanti a te", "Riconoscersi", "Qui"],
    texts: [
      "E poi eccolo, quel momento che fino a poco prima esisteva soltanto nell'immaginazione.",
      "Non serve spiegare uno sguardo che dice già tutto.",
      "In mezzo a tante persone, basta incontrare gli occhi giusti.",
      "Il mondo continua a muoversi. Per un istante, loro no.",
    ],
    long: [
      "Ci sono momenti che non hanno bisogno di essere costruiti. Arrivano semplicemente.\nUn passo, uno sguardo, un sorriso che cambia tutto.\n\nPer qualche secondo il resto scompare. Non perché non esista più, ma perché non serve altro.",
    ],
  },
  {
    category: "cerimonia", tone: "elegant", intensity: 4, tags: ["cerimonia", "coppia", "promesse", "famiglia"],
    titles: ["Il momento delle promesse", "Qui e ora", "Davanti a tutti", "Le parole importanti", "Una promessa", "Il sì", "Da questo momento", "Insieme", "Il momento che resta"],
    short: [
      "Alcune parole durano pochi secondi e diventano parte di una vita intera.",
      "Ci sono promesse che non hanno bisogno di essere pronunciate a voce alta.",
      "Davanti alle persone più importanti, il futuro prende finalmente una forma.",
      "Un sì può essere una parola breve. Il significato che porta con sé, invece, non lo è affatto.",
    ],
    medium: [
      "La cerimonia raccoglie in pochi minuti ciò che è stato, ciò che è e ciò che ancora deve arrivare. Le parole diventano promessa, gli sguardi diventano risposta.",
      "Per un istante tutto è semplice. Due persone, poche parole e la consapevolezza che da quel momento alcune cose avranno un nome diverso.",
    ],
  },
  {
    category: "sguardi", tone: "intimate", intensity: 3, tags: ["sguardi", "coppia", "ritratto"],
    titles: ["Senza parole", "Gli occhi raccontano", "Uno sguardo", "Capirsi", "Tra le parole", "Quello che non si dice", "Basta uno sguardo"],
    short: [
      "Alcune cose si capiscono prima ancora di essere dette.",
      "Gli occhi arrivano sempre un momento prima delle parole.",
      "Uno sguardo può contenere una storia intera.",
      "Ci sono dialoghi che non hanno bisogno di voce.",
    ],
    medium: [
      "In una giornata piena di parole, sono spesso gli sguardi a raccontare le cose più importanti. Quelli veloci, quelli rubati, quelli che durano appena un istante e proprio per questo rimangono.",
    ],
  },
  {
    category: "ritratto_coppia", tone: "intimate", intensity: 3, tags: ["ritratto", "coppia", "luogo", "paesaggio"],
    titles: ["Solo loro", "Un momento per due", "Fuori dal tempo", "Insieme", "Lontano dal rumore", "Due", "Il loro spazio", "Un passo più in là", "Quando resta soltanto il tempo"],
    short: [
      "Per qualche minuto, il resto può aspettare.",
      "Due persone, un luogo, tutto il tempo necessario.",
      "Lontano dal rumore, rimane ciò che conta.",
      "Ci sono momenti in cui non serve fare nulla. Basta esserci.",
    ],
    medium: [
      "Per qualche minuto la giornata smette di appartenere agli altri. Nessun programma, nessuna corsa, nessuna attenzione da dividere. Solo uno spazio piccolo e prezioso in cui ritrovarsi.",
      "Non è necessario fermare il tempo. Basta accorgersi che, per un momento, sembra farlo da solo.",
      "Per qualche minuto il tempo sembra rallentare.\nNon ci sono più invitati, telefoni, programmi da rispettare. Solo due persone che si ritrovano, finalmente, dentro la stessa giornata.\nE in quello spazio sospeso, anche un gesto piccolo può diventare un ricordo.",
    ],
    long: [
      "Il giorno corre veloce.\nLe persone, la musica, le voci, gli appuntamenti si susseguono senza lasciare troppo spazio per respirare.\n\nPoi arriva un momento diverso.\nUn luogo lontano dal rumore, qualche minuto senza nessuno intorno.\n\nEd è lì che la giornata trova il suo equilibrio: due persone che si guardano e ricordano, anche solo per un istante, perché tutto questo è cominciato.",
    ],
  },
  {
    category: "intimita", tone: "intimate", intensity: 3, tags: ["coppia", "ritratto", "sguardi", "dettagli"],
    titles: ["La loro misura", "Vicini", "Tra noi", "Il posto giusto", "Qui con te", "Senza bisogno di altro", "La distanza più breve"],
    short: [
      "L'intimità non ha bisogno di grandi gesti.",
      "A volte basta avvicinarsi.",
      "La felicità ha spesso una forma molto semplice.",
      "Alcune persone fanno sembrare naturale qualsiasi posto.",
    ],
    medium: [
      "Non c'è bisogno di cercare un momento perfetto. A volte è sufficiente quello che esiste già: una mano, una vicinanza, una risata improvvisa, il modo in cui ci si guarda quando nessuno sta guardando.",
    ],
    pairs: [
      { title: "Nel mezzo di tutto", text: "Tra una risata e uno sguardo, tra la musica e le voci degli altri, esiste un momento che appartiene soltanto a loro.\nNon dura abbastanza da essere programmato.\nNon è abbastanza rumoroso da essere ricordato da tutti.\n\nEppure, spesso, sono proprio questi i momenti che rimangono.", tags: ["coppia", "ritratto", "festa", "ricevimento"] },
    ],
  },
  {
    category: "dettagli", tone: "minimal", intensity: 2, tags: ["dettagli", "preparativi", "ricevimento", "location"],
    titles: ["Piccole cose", "I dettagli", "Quello che rimane", "Particolari", "In punta di memoria", "Ogni cosa al suo posto", "Le piccole storie"],
    short: [
      "La memoria ama i dettagli.",
      "Un dettaglio può riportare indietro un'intera giornata.",
      "Le grandi giornate sono fatte anche di piccole cose.",
      "Ciò che sembra secondario oggi potrebbe essere ciò che domani farà ricordare tutto.",
    ],
    medium: [
      "Un profumo, una texture, un fiore, una mano, un bottone, una scarpa lasciata per un momento in disparte. I dettagli non raccontano tutta la storia, ma spesso sono quelli che permettono di ricordarla.",
    ],
  },
  {
    category: "invitati", tone: "editorial", intensity: 2, tags: ["invitati", "famiglia", "amici", "ricevimento"],
    titles: ["Tutti insieme", "Le persone del giorno", "Intorno a loro", "La festa comincia", "Una stanza piena di storie", "Quelli che hanno condiviso il giorno"],
    texts: [
      "Ogni invitato porta con sé una storia diversa. Quel giorno, per qualche ora, tutte finiscono nello stesso racconto.",
      "Una festa non è fatta soltanto di chi la vive al centro. È fatta anche di chi guarda, ride, abbraccia, aspetta e condivide.",
      "Attorno a loro c'è tutto ciò che rende una giornata impossibile da ripetere: persone, relazioni, ricordi e incontri.",
    ],
  },
  {
    category: "ricevimento", tone: "celebratory", intensity: 3, tags: ["ricevimento", "invitati", "festa", "tavola"],
    titles: ["La festa", "Adesso si festeggia", "Dopo le promesse", "Il tempo della festa", "A tavola", "Tutto prende vita", "La parte più rumorosa", "Finalmente festa"],
    short: [
      "Dopo le parole arrivano le risate.",
      "Ora non c'è più niente da aspettare.",
      "La giornata cambia ritmo.",
      "Il resto può aspettare. Adesso si festeggia.",
    ],
    medium: [
      "Quando le promesse sono state pronunciate e l'attesa è finita, il giorno cambia volto. Le persone si avvicinano, la musica prende spazio, le risate diventano più forti. È il momento in cui una storia privata diventa una festa condivisa.",
    ],
  },
  {
    category: "festa", tone: "celebratory", intensity: 4, tags: ["festa", "ballo", "amici", "spontaneita", "notte"],
    titles: ["Senza freni", "La notte", "Tutti in pista", "Lasciarsi andare", "Il ritmo", "Fuori programma", "Ancora una canzone", "Fino a tardi", "La parte migliore", "Nessuno vuole andare via"],
    short: [
      "A un certo punto, smettere di pensare è il modo migliore per vivere la festa.",
      "La musica fa il resto.",
      "Ci sono serate che finiscono troppo presto.",
      "Quando tutti smettono di guardare l'orologio, la festa è davvero cominciata.",
    ],
    medium: [
      "Poi arriva quella parte della giornata in cui le regole diventano meno importanti. Le scarpe si tolgono, le giacche si aprono, la musica prende il comando e anche chi aveva promesso di non ballare finisce in pista.",
    ],
  },
  {
    category: "spontaneita", tone: "celebratory", intensity: 2, tags: ["spontaneita", "amici", "festa", "invitati"],
    titles: ["Fuori programma", "Come viene", "Senza pensarci", "La parte vera", "Spontaneamente", "Senza copione", "Così, semplicemente"],
    short: [
      "Le cose migliori spesso non erano state previste.",
      "La spontaneità non chiede permesso.",
      "Una risata sincera non ha bisogno di essere preparata.",
      "Il momento perfetto raramente arriva quando lo si sta cercando.",
    ],
    medium: [
      "In mezzo a una giornata organizzata nei minimi dettagli, sono spesso gli imprevisti a lasciare i ricordi più belli. Una battuta, una risata improvvisa, un gesto fuori programma. Tutto ciò che non era previsto finisce per diventare parte della storia.",
    ],
  },
  {
    category: "tramonto", tone: "poetic", intensity: 3, tags: ["tramonto", "paesaggio", "coppia", "ritratto", "luogo"],
    titles: ["L'ora d'oro", "Quando cambia la luce", "Prima di sera", "La luce che rimane", "Un'altra luce", "Il giorno rallenta", "Verso sera", "Quando il sole scende"],
    short: [
      "Anche la luce sembra sapere che il giorno sta finendo.",
      "Il sole scende lentamente e tutto assume un colore diverso.",
      "Ci sono momenti in cui la luce sembra fermare il tempo.",
      "Il giorno cambia ancora una volta volto.",
    ],
    medium: [
      "Il sole comincia a scendere e la giornata trova un'altra luce. Tutto diventa più lento, più morbido, quasi sospeso. È il momento in cui il giorno sembra voler lasciare un'ultima immagine prima di andare via.",
    ],
  },
  {
    category: "notte", tone: "reflective", intensity: 3, tags: ["notte", "festa", "ballo", "finale"],
    titles: ["Dopo il tramonto", "Quando arriva la notte", "Le ultime ore", "Ancora un po'", "La notte appena iniziata", "Sotto le luci", "Fino alla fine"],
    medium: [
      "Quando arriva la notte, la giornata non è ancora finita. Le luci diventano più calde, la musica più presente, i sorrisi più stanchi e sinceri. È il momento in cui nessuno vuole ancora dire che è arrivata la fine.",
    ],
  },
  {
    category: "finale", tone: "reflective", intensity: 4, tags: ["finale", "closing", "notte", "coppia"], extraPlacement: ["closing"],
    titles: ["E poi rimane questo", "Dopo tutto", "La fine di un giorno", "Quello che resta", "Alla fine", "L'ultima pagina", "Una giornata da ricordare", "E domani", "Da qui in poi", "Fine dell'inizio"],
    short: [
      "Una giornata finisce. Quello che ha lasciato, no.",
      "Il tempo passa. Alcuni momenti decidono di restare.",
      "E alla fine rimangono le immagini, le voci, le persone.",
      "Una pagina si chiude. La storia continua.",
    ],
    medium: [
      "Quando la musica finisce e le luci cominciano a spegnersi, la giornata diventa già memoria. Rimangono gli abbracci, le risate, gli sguardi e tutte quelle piccole cose che, mentre accadevano, sembravano normali.",
    ],
    long: [
      "Ogni giornata ha una fine.\nAnche questa, prima o poi, ha rallentato il suo ritmo, lasciando dietro di sé una casa da riordinare, fiori da raccogliere, abiti da riporre e persone che tornano lentamente alla vita di tutti i giorni.\n\nMa alcune giornate non finiscono davvero.\nRestano nelle fotografie, nei racconti, nei ricordi che torneranno fuori molti anni dopo.\n\nPerché il tempo porta via quasi tutto.\nNon sempre, però, riesce a portare via ciò che abbiamo scelto di ricordare.",
    ],
    pairs: [
      { title: "E poi rimane questo", text: "Quando la musica finisce, gli ultimi invitati vanno via e le luci si spengono una dopo l'altra, resta ciò che non aveva bisogno di essere spiegato.\n\nGli abbracci.\nLe mani.\nLe risate.\nGli occhi stanchi alla fine di una giornata troppo breve.\n\nIl resto diventa memoria." },
    ],
  },
  {
    category: "universali", tone: "reflective", intensity: 2, tags: ["universali"],
    texts: [
      "Ci sono momenti che non chiedono di essere spiegati. Chiedono soltanto di essere ricordati.",
      "Il tempo passa attraverso le persone, i luoghi, le giornate. Alcuni istanti, però, sembrano riuscire a fermarlo.",
      "La memoria non conserva tutto. Sceglie. E spesso sceglie proprio i dettagli che, nel momento in cui accadevano, sembravano più piccoli.",
      "Alcuni ricordi non hanno bisogno di essere cercati. Basta una fotografia per farli tornare esattamente dove erano.",
      "Non tutte le cose importanti fanno rumore.",
      "Il tempo trasforma i momenti in ricordi. Le immagini danno ai ricordi un luogo in cui tornare.",
      "Ci sono giornate che sembrano durare poche ore e rimanere per tutta la vita.",
      "Ogni fotografia trattiene qualcosa che il tempo, da solo, non avrebbe saputo conservare.",
      "Le giornate passano. Alcune lasciano una traccia.",
      "Il ricordo comincia sempre da qualcosa di piccolo.",
    ],
  },
  {
    category: "poetici", tone: "poetic", intensity: 3, tags: ["universali", "opening", "closing", "coppia", "paesaggio"], extraPlacement: ["opening", "closing"],
    texts: [
      "Il tempo non si ferma.\nMa qualche volta rallenta abbastanza da lasciarsi ricordare.",
      "Ci sono giorni fatti di minuti.\nE poi ci sono giorni fatti di ricordi.",
      "Prima arriva l'attesa.\nPoi il momento.\nPoi tutto diventa memoria.",
      "Le persone cambiano.\nI luoghi cambiano.\nGli anni passano.\nAlcuni momenti, invece, continuano ad assomigliare esattamente a se stessi.",
      "Forse è questo che fanno i ricordi: prendono qualcosa che è già passato e gli permettono di accadere ancora.",
    ],
  },
  {
    category: "cinematografici", tone: "cinematic", intensity: 3, tags: ["universali"], extraPlacement: ["section_intro", "opening", "double_page"],
    pairs: [
      { title: "Scena I — Prima che inizi", text: "La giornata è ancora intatta.\nLe stanze sono silenziose, le persone cominciano appena a muoversi e nessuno sa ancora quali saranno i momenti che verranno ricordati più a lungo.", tags: ["opening", "preparativi", "casa", "dettagli"] },
      { title: "Scena II — L'attesa", text: "Ancora pochi minuti.\nIl tempo sembra avere un ritmo diverso quando qualcosa di importante sta per accadere.", tags: ["attesa", "preparativi", "cerimonia"] },
      { title: "Scena III — L'incontro", text: "E poi gli occhi si incontrano.\nTutto ciò che era stato immaginato diventa improvvisamente reale.", tags: ["incontro", "sguardi", "coppia"] },
      { title: "Scena IV — Il giorno", text: "Da questo momento non c'è più nulla da aspettare.\nIl giorno è cominciato davvero.", tags: ["cerimonia", "coppia", "promesse"] },
      { title: "Scena V — La festa", text: "Le formalità finiscono.\nLa musica comincia.\nIl resto può aspettare.", tags: ["festa", "ricevimento", "ballo", "amici"] },
      { title: "Scena VI — Dopo", text: "La giornata è finita.\nMa non tutto ciò che è accaduto ha intenzione di farlo.", tags: ["finale", "closing", "notte"], extraPlacement: ["closing"] },
    ],
  },
  {
    category: "chiusure", tone: "elegant", intensity: 4, tags: ["closing", "finale"], extraPlacement: ["closing"],
    texts: [
      "E così una giornata diventa memoria.",
      "Il tempo continuerà a scorrere. Questa giornata, invece, resterà qui.",
      "Alcune storie meritano più di una memoria.",
      "Il giorno finisce. Il ricordo appena comincia.",
      "Una fotografia non ferma il tempo. Gli dà un posto in cui tornare.",
      "Da qualche parte, nel futuro, questo giorno tornerà ancora.",
      "E ogni volta sembrerà di essere di nuovo lì.",
    ],
  },
];

/** Parole e brevissime espressioni per quando lo spazio è minimo. */
const MICROCOPY: readonly string[] = [
  "L'attesa", "Finalmente", "Insieme", "Qui", "Adesso", "Noi", "Sempre", "Ancora", "Vicini", "Un istante", "Quel momento", "Senza parole",
  "Prima", "Dopo", "Insieme, ancora", "Da qui", "Per sempre", "Oggi", "Il giorno", "La notte", "Tutto comincia", "Eccoci", "Finalmente insieme",
  "Solo noi", "Il momento", "Quello che resta", "Da ricordare", "Ancora un po'", "Fino a tardi", "Senza fretta", "Tutto il resto può aspettare",
];

/**
 * Citazioni d'autore: restano separate dalle frasi originali e non si propongono mai da sole. La fonte non è stata verificata riga per riga
 * (per due di esse l'attribuzione è anche discussa), quindi va controllata prima di stamparle in un prodotto.
 */
const QUOTES: ReadonlyArray<{ author: string; text: string }> = [
  { author: "Antoine de Saint-Exupéry", text: "Amare non è guardarsi l'un l'altro, ma guardare insieme nella stessa direzione." },
  { author: "Antoine de Saint-Exupéry", text: "È il tempo che hai perduto per la tua rosa che ha fatto la tua rosa così importante." },
  { author: "Marcel Proust", text: "Il vero viaggio di scoperta non consiste nel cercare nuove terre, ma nell'avere nuovi occhi." },
  { author: "Gabriel García Márquez", text: "Ci si può innamorare molte volte, ma si ama davvero una sola volta." },
  { author: "Khalil Gibran", text: "Amatevi l'un l'altro, ma non fate dell'amore un legame." },
  { author: "Khalil Gibran", text: "E state insieme, ma non troppo vicini: perché le colonne del tempio stanno separate." },
];

// ---------------------------------------------------------------------------
// Costruzione
// ---------------------------------------------------------------------------

const PLACEMENT_BY_TYPE: Record<StoryType, readonly StoryPlacement[]> = {
  title: ["section_intro", "image_overlay", "small_space"],
  microcopy: ["small_space", "image_overlay"],
  short: ["text_block", "image_overlay", "small_space"],
  medium: ["text_block", "full_page", "double_page"],
  long: ["full_page", "double_page"],
  quote: ["text_block", "full_page"],
};

const unique = <T,>(values: readonly T[]): T[] => [...new Set(values)];

function paragraphType(length: StoryLength): StoryType {
  return length === "micro" || length === "short" ? "short" : length === "medium" ? "medium" : "long";
}

function build(): StoryUnit[] {
  const units: StoryUnit[] = [];
  const counters = new Map<string, number>();
  const nextId = (category: StoryCategory, kind: string) => {
    const key = `${category}_${kind}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return `${key}_${String(n).padStart(3, "0")}`;
  };
  const base = (spec: Spec, type: StoryType, length: StoryLength, extra: readonly StoryPlacement[] = []) => ({
    category: spec.category,
    type,
    length,
    tone: spec.tone,
    emotionalIntensity: spec.intensity,
    recommendedFor: [...spec.tags],
    placement: unique([...PLACEMENT_BY_TYPE[type], ...(spec.extraPlacement ?? []), ...extra]),
    original: true,
    author: null,
  });

  for (const spec of SPECS) {
    // Un paragrafo che compare anche in una coppia titolo + testo resta solo nella coppia.
    const inPairs = new Set((spec.pairs ?? []).map((pair) => storyKey(pair.text)));
    const fresh = (items: readonly string[] | undefined) => (items ?? []).filter((text) => !inPairs.has(storyKey(text)));
    for (const title of spec.titles ?? []) units.push({ id: nextId(spec.category, "title"), ...base(spec, "title", "micro"), title });
    // Le etichette del testo di partenza (brevi, medi, lunghi) contano più dei caratteri: indicano le righe che il testo occupa.
    for (const text of fresh(spec.short)) units.push({ id: nextId(spec.category, "short"), ...base(spec, "short", lengthOfText(text) === "micro" ? "micro" : "short"), text });
    for (const text of fresh(spec.medium)) units.push({ id: nextId(spec.category, "medium"), ...base(spec, "medium", "medium"), text });
    for (const text of fresh(spec.long)) units.push({ id: nextId(spec.category, "long"), ...base(spec, "long", "long"), text });
    for (const text of fresh(spec.texts)) {
      const length = lengthOfText(text);
      units.push({ id: nextId(spec.category, "text"), ...base(spec, paragraphType(length), length), text });
    }
    for (const pair of spec.pairs ?? []) {
      const length = lengthOfText(pair.text);
      const unit: StoryUnit = { id: nextId(spec.category, "pair"), ...base(spec, paragraphType(length), length, pair.extraPlacement), title: pair.title, text: pair.text };
      units.push(pair.tags ? { ...unit, recommendedFor: [...pair.tags] } : unit);
    }
  }

  for (const text of MICROCOPY) {
    units.push({
      id: nextId("microcopy", "micro"), category: "microcopy", type: "microcopy", length: "micro", tone: "minimal", emotionalIntensity: 2,
      recommendedFor: ["universali"], placement: [...PLACEMENT_BY_TYPE.microcopy], original: true, author: null, text,
    });
  }

  for (const quote of QUOTES) {
    const length = lengthOfText(quote.text);
    units.push({
      id: nextId("citazioni", "quote"), category: "citazioni", type: "quote", length, tone: "reflective", emotionalIntensity: 3,
      recommendedFor: ["universali", "cerimonia", "coppia"], placement: [...PLACEMENT_BY_TYPE.quote], original: false, author: quote.author, text: quote.text, needsSourceCheck: true,
    });
  }
  return units;
}

/** L'intera libreria, nell'ordine in cui è scritta. */
export const STORY_LIBRARY: readonly StoryUnit[] = build();

const BY_ID = new Map(STORY_LIBRARY.map((unit) => [unit.id, unit]));

export const storyById = (id: string): StoryUnit | undefined => BY_ID.get(id);

/** Testo che compare a pagina: il paragrafo se c'è, altrimenti il titolo. */
export const storyDisplayText = (unit: StoryUnit): string => unit.text ?? unit.title ?? "";
