import type { TextStyleSpec } from "@photo-tools/shared-types";
import { newId } from "./ids";
import { TEXT_LIMITS, sanitizeTextStyle } from "./typography";

/**
 * Il tuo archivio di frasi e di stili di testo, valido per tutti gli album (sta nel salvataggio locale del programma).
 * Le frasi di partenza sono esempi in italiano: si modificano e si cancellano come le tue.
 */

export interface Phrase {
  id: string;
  text: string;
  /** Raggruppa le frasi nell'elenco (es. «Matrimonio», «Viaggio»). */
  group: string;
  /** Nome dello stile da usare quando la inserisci, se ne hai scelto uno. */
  styleName?: string;
}

export interface SavedTextStyle {
  id: string;
  name: string;
  style: TextStyleSpec;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const LIBRARY_KEYS = {
  phrases: "filex.albumFlow.v2.phrases",
  styles: "filex.albumFlow.v2.textStyles",
  /** Versione delle frasi di partenza già unite alla tua libreria. */
  seedVersion: "filex.albumFlow.v2.phrasesSeedVersion",
} as const;

/** Sale quando si aggiungono frasi di partenza: chi ha già una libreria le riceve una sola volta, senza perdere né far riapparire nulla. */
export const SEED_VERSION = 4;

export const MAX_PHRASES = 500;
export const MAX_SAVED_STYLES = 100;

const BASE_SEED_PHRASES: readonly Omit<Phrase, "id">[] = [
  { group: "Matrimonio", text: "Il giorno più bello" },
  { group: "Matrimonio", text: "Per sempre inizia oggi" },
  { group: "Matrimonio", text: "Sì, lo voglio" },
  { group: "Matrimonio", text: "Insieme, da questo momento" },
  { group: "Matrimonio", text: "Save the date" },
  { group: "Matrimonio", text: "Il nostro amore, in un giorno" },
  { group: "Famiglia", text: "Casa è dove siamo insieme" },
  { group: "Famiglia", text: "Piccoli passi, grandi ricordi" },
  { group: "Famiglia", text: "Radici e ali" },
  { group: "Famiglia", text: "Le cose che contano davvero" },
  { group: "Viaggio", text: "Ovunque, purché insieme" },
  { group: "Viaggio", text: "Strade, luce, ricordi" },
  { group: "Viaggio", text: "Il mondo ha ancora tanto da mostrarci" },
  { group: "Titoli", text: "Capitolo primo" },
  { group: "Titoli", text: "Indice" },
  { group: "Titoli", text: "Grazie" },
];

/** Frasi aggiunte nella versione 2: matrimonio, in stile editoriale. */
export const NEW_SEED_PHRASES: readonly Omit<Phrase, "id">[] = [
  { group: "Matrimonio", text: "Due cuori, una sola strada" },
  { group: "Matrimonio", text: "Oggi diciamo sì al nostro per sempre" },
  { group: "Matrimonio", text: "Un giorno, mille emozioni" },
  { group: "Matrimonio", text: "L'amore ha deciso di restare" },
  { group: "Matrimonio", text: "Mano nella mano, per tutta la vita" },
  { group: "Matrimonio", text: "Eravamo noi, da sempre" },
  { group: "Matrimonio", text: "Il sì più bello" },
  { group: "Matrimonio", text: "Ci siamo scelti" },
  { group: "Cerimonia", text: "Il silenzio prima del sì" },
  { group: "Cerimonia", text: "Le promesse" },
  { group: "Cerimonia", text: "Gli sguardi dicono tutto" },
  { group: "Cerimonia", text: "Un bacio, e il resto sparisce" },
  { group: "Cerimonia", text: "Pronti per il grande passo" },
  { group: "Cerimonia", text: "Le lacrime che non si nascondono" },
  { group: "Cerimonia", text: "Dal sì all'eternità" },
  { group: "Cerimonia", text: "Applausi, riso e petali al vento" },
  { group: "Festa", text: "Si brinda all'amore" },
  { group: "Festa", text: "Il primo ballo" },
  { group: "Festa", text: "Balliamo finché c'è musica" },
  { group: "Festa", text: "Tutti a tavola" },
  { group: "Festa", text: "Il taglio della torta" },
  { group: "Festa", text: "La festa è appena iniziata" },
  { group: "Festa", text: "Risate che si sentono da lontano" },
  { group: "Festa", text: "Un brindisi a noi" },
  { group: "Dettagli", text: "Le mani" },
  { group: "Dettagli", text: "Gli anelli" },
  { group: "Dettagli", text: "Il bouquet" },
  { group: "Dettagli", text: "L'abito, il velo, l'attesa" },
  { group: "Dettagli", text: "Piccole cose, grandi emozioni" },
  { group: "Dettagli", text: "Il dettaglio che resta" },
  { group: "Dettagli", text: "Fiori, luce e carta" },
  { group: "Dettagli", text: "Le scarpe, il profumo, i gioielli" },
  { group: "Ringraziamenti", text: "Grazie di cuore" },
  { group: "Ringraziamenti", text: "Grazie per averci accompagnato" },
  { group: "Ringraziamenti", text: "Con tutto l'amore che abbiamo" },
  { group: "Ringraziamenti", text: "Ai nostri genitori" },
  { group: "Ringraziamenti", text: "Agli amici di sempre" },
  { group: "Ringraziamenti", text: "Per averci fatto sentire a casa" },
  { group: "Capitoli", text: "La storia" },
  { group: "Capitoli", text: "I dettagli" },
  { group: "Capitoli", text: "Gli ospiti" },
  { group: "Capitoli", text: "Il ritratto di coppia" },
  { group: "Capitoli", text: "Prima del sì" },
  { group: "Capitoli", text: "Dopo il sì" },
  { group: "Capitoli", text: "Gli ultimi scatti" },
];

/** Frasi aggiunte nella versione 3: testi narrativi, nel gruppo «Racconto». */
export const STORY_SEED_PHRASES: readonly Omit<Phrase, "id">[] = [
  "Ci sono momenti che non chiedono di essere ricordati, perché trovano da soli il modo di restare. Si posano nel cuore e diventano parte di ciò che siamo.",
  "Amarsi è riconoscersi tra mille possibilità, ritrovarsi in uno sguardo e continuare a scegliersi anche quando la vita cambia forma.",
  "Non esiste un istante preciso in cui nasce l'eternità. A volte comincia con una promessa sussurrata, altre con una mano che non smette di cercare l'altra.",
  "Non sono i giorni perfetti a rendere straordinaria una storia, ma la capacità di trovare bellezza anche nelle piccole cose, negli imprevisti e nelle fragilità condivise.",
  "Casa non è un luogo da raggiungere, ma quella sensazione rara di poter abbassare ogni difesa e sentirsi finalmente nel posto giusto.",
  "Ci sono parole che non hanno bisogno di voce. Vivono negli occhi, attraversano il silenzio e arrivano esattamente dove devono arrivare.",
  "Davanti non c'è una strada già scritta, ma un orizzonte da inventare insieme. Ogni passo sarà una scoperta, ogni scelta un nuovo modo di appartenersi.",
  "Ogni grande storia custodisce un piccolo inizio. E in quel primo passo, apparentemente semplice, esiste già tutto ciò che un giorno chiameremo vita.",
  "La felicità cambia peso quando viene condivisa. Diventa più leggera nei giorni difficili, più intensa nelle gioie e più preziosa quando trova qualcuno con cui restare.",
  "Quando i fiori appassiscono e le luci si spengono, rimane ciò che conta davvero: la promessa di esserci, la voglia di capirsi e il coraggio di ricominciare.",
  "Ogni storia porta con sé altre storie. Volti, sacrifici, abbracci e insegnamenti diventano radici invisibili, capaci di sostenere anche i sogni più grandi.",
  "Ci saranno fotografie da sfogliare e dettagli da riscoprire, ma la parte più preziosa di questo giorno sarà quella che nessuna immagine potrà contenere interamente: l'emozione di averlo vissuto.",
  "Al di là delle parole pronunciate, esiste una promessa più profonda: restare curiosi l'uno dell'altra, continuare a conoscersi e non dare mai per scontato il privilegio di esserci.",
  "Un caffè preparato senza chiedere, una risata fuori programma, una mano stretta sotto il tavolo. Spesso l'amore più grande abita proprio nelle cose che sembrano più piccole.",
  "Oggi si celebra una promessa, domani saranno i gesti a darle significato. Nei giorni luminosi e in quelli più difficili, sarà la cura reciproca a trasformare una promessa in una vita.",
].map((text) => ({ group: "Racconto", text }));

const inGroup = (group: string, texts: readonly string[]): Omit<Phrase, "id">[] => texts.map((text) => ({ group, text }));

/** Frasi aggiunte nella versione 4: famiglia, fotografia e ricordi, momenti ed emozioni, infanzia e crescita. */
export const MORE_STORY_SEED_PHRASES: readonly Omit<Phrase, "id">[] = [
  ...inGroup("Famiglia", [
    "La famiglia è quel luogo invisibile in cui le nostre storie si intrecciano, dove ogni generazione lascia qualcosa di sé e ogni nuovo arrivo rende il racconto ancora più grande.",
    "Prima ancora di sapere chi saremmo diventati, c'erano già mani pronte a sostenerci, voci capaci di rassicurarci e cuori che ci avevano fatto spazio.",
    "Non siamo soltanto le persone che compongono una famiglia, ma tutti i momenti che abbiamo condiviso, le difficoltà superate e le piccole felicità che nessuno ha mai pensato di fotografare.",
    "Un giorno ci accorgeremo che le cose più preziose non erano le grandi occasioni, ma le domeniche senza programmi, le tavole rumorose e il tempo trascorso senza guardare l'orologio.",
    "Nei volti dei figli ritroviamo qualcosa di noi, negli occhi dei genitori riconosciamo le nostre origini e nei gesti dei nonni scopriamo una memoria che attraversa il tempo.",
    "La famiglia non ferma il tempo, ma gli dà un significato. Trasforma gli anni in ricordi, le abitudini in tradizioni e i momenti ordinari in qualcosa che un giorno chiameremo prezioso.",
    "Crescere non significa soltanto diventare grandi. Significa imparare a cambiare restando vicini, lasciare spazio ai sogni di ciascuno e continuare a riconoscersi anche quando tutto si trasforma.",
    "Alla fine, ciò che porteremo con noi non sarà la perfezione delle nostre giornate, ma il calore delle persone che le hanno rese indimenticabili.",
    "Ci sono eredità che non si custodiscono nei cassetti: vivono nelle parole che ripetiamo, nei valori che trasmettiamo e nel modo in cui impariamo a volerci bene.",
    "Ovunque ci porterà la vita, ci sarà sempre un abbraccio capace di riportarci alle origini. Perché certe persone non sono soltanto parte del nostro mondo: sono il luogo in cui il mondo torna ad avere senso.",
    "Non serve avere sempre qualcosa da festeggiare. A volte la fortuna più grande è ritrovarsi tutti nella stessa stanza e sapere che, almeno per quel momento, non manca nessuno.",
    "Li guardiamo crescere pensando a tutto ciò che li aspetta, senza accorgerci che intanto stanno cambiando anche noi. E mentre imparano a diventare grandi, ci insegnano ogni giorno una nuova forma d'amore.",
  ]),
  ...inGroup("Fotografia e ricordi", [
    "La fotografia non ferma davvero il tempo. Ci regala qualcosa di diverso: la possibilità di tornare, anche solo per un istante, nel luogo in cui un'emozione ha cominciato a vivere.",
    "Una fotografia mostra ciò che era davanti all'obiettivo, ma custodisce anche tutto quello che non si vede: l'attesa, le parole sussurrate, i pensieri e le emozioni rimaste in silenzio.",
    "La luce cambia, le stagioni passano e i volti crescono. Eppure, in una fotografia, qualcosa di quel momento continua a parlarci con la stessa intensità.",
    "Ci sono fotografie che diventano più preziose con gli anni. Non perché siano cambiate loro, ma perché siamo cambiati noi e finalmente comprendiamo ciò che allora non sapevamo ancora vedere.",
    "Un giorno dimenticheremo il colore dei fiori, la musica in sottofondo e persino alcuni dettagli della giornata. Sarà una fotografia a restituirci un particolare dimenticato e, insieme a esso, un'intera emozione.",
    "Ogni scatto è un frammento di tempo sottratto alla fretta. Un istante che sembrava destinato a scomparire e che invece trova il modo di accompagnarci negli anni.",
    "Le immagini più autentiche non sono necessariamente quelle perfette. Sono quelle in cui ci riconosciamo davvero, con i nostri sorrisi spontanei, le imperfezioni e la bellezza di essere esattamente ciò che siamo.",
    "Basta riaprire un vecchio album per ritrovare una voce, un profumo, una stanza e persino la persona che eravamo allora. La memoria ha strade misteriose, e spesso cominciano da una fotografia.",
    "Fotografare significa riconoscere valore a qualcosa mentre sta accadendo. Significa dire, senza bisogno di parole, che quel momento merita di essere conservato.",
    "Ci sono emozioni che diventano difficili da raccontare con il passare degli anni. Le fotografie, invece, continuano a parlarci senza chiedere spiegazioni.",
    "I luoghi saranno diversi, i bambini saranno adulti e alcune voci saranno diventate ricordi. Ma in queste immagini resterà la possibilità di incontrarci ancora, proprio come eravamo.",
    "Un album non è una raccolta di immagini ordinate nel tempo. È una storia da attraversare, un pezzo di vita da tramandare e un modo per ricordare a chi verrà dopo di noi da dove tutto è cominciato.",
    "La vita non ci avvisa quando sta creando un ricordo importante. Spesso lo comprendiamo soltanto dopo, quando vorremmo rivivere proprio quel momento che allora ci sembrava uno dei tanti.",
    "Talvolta lo scatto più bello nasce lontano da ogni programma: in una risata improvvisa, in uno sguardo distratto o in un gesto che nessuno aveva pensato di mettere in posa.",
    "Forse un giorno queste immagini saranno osservate da occhi che oggi non conosciamo ancora. E attraverso i nostri sorrisi potranno scoprire i volti, le storie e l'amore che li hanno preceduti.",
  ]),
  ...inGroup("Momenti ed emozioni", [
    "Aspettiamo spesso il momento giusto per fermarci, guardare e apprezzare ciò che abbiamo. Ma la vita, quella vera, sta già accadendo nelle piccole cose che attraversano le nostre giornate.",
    "Non tutti i momenti importanti fanno rumore. Alcuni si nascondono in una carezza distratta, in una mano cercata senza pensarci e nella tranquillità di sentirsi al sicuro accanto a qualcuno.",
    "Ci sono giorni che sembrano ordinari mentre li viviamo, ma che un domani vorremmo poter riabbracciare. Forse la nostalgia nasce proprio così: dal capire troppo tardi quanto fosse speciale ciò che avevamo.",
    "La felicità più sincera raramente si mette in posa. Arriva mentre ridiamo, quando dimentichiamo il resto del mondo o quando ci accorgiamo che le persone giuste sono già tutte qui.",
    "Un raggio di sole sul pavimento, una voce familiare nell'altra stanza, una risata che riempie la casa. A volte la felicità non ha bisogno di essere cercata: ha solo bisogno di essere riconosciuta.",
    "Non possiamo conservare ogni giorno, né trattenere ogni stagione della vita. Possiamo però imparare a guardare con più attenzione ciò che ci circonda, perché anche il tempo più semplice può nascondere qualcosa di irripetibile.",
    "Ciò che rende speciale un momento non è sempre quello che accade, ma la persona con cui lo viviamo e il significato che, senza saperlo, gli affidiamo.",
    "Guardiamoci un po' più a lungo, abbracciamoci senza fretta, ridiamo ancora. Non perché ogni momento debba essere perfetto, ma perché anche le giornate più normali stanno costruendo la nostra storia.",
  ]),
  ...inGroup("Infanzia e crescita", [
    "Per un bambino il mondo è ancora pieno di prime volte. Una foglia può diventare un tesoro, una pozzanghera un oceano e un pomeriggio qualunque un'avventura da raccontare.",
    "Ci sono manine che oggi cercano le nostre e che domani impareranno a fare da sole. Forse è questo il paradosso più dolce della genitorialità: desiderare che crescano e voler trattenere ogni istante.",
    "L'infanzia non dura per sempre, ma lascia tracce profonde. Vive nei racconti di famiglia, nelle fotografie ingiallite e nei gesti che, molti anni dopo, continueremo a ripetere senza sapere da chi li abbiamo imparati.",
    "I bambini ci ricordano che la meraviglia non è scomparsa dal mondo. Siamo soltanto noi adulti, a volte, ad aver dimenticato come guardarlo.",
    "Un giorno queste fotografie racconteranno anche a te ciò che oggi non puoi ancora comprendere: quanto eri atteso, quanta felicità portavi e quante persone si sono innamorate di te fin dal principio.",
    "Accompagnarli mentre crescono significa imparare a lasciar andare un pezzetto alla volta, sapendo che ogni passo verso il mondo porterà con sé qualcosa dell'amore ricevuto a casa.",
  ]),
];

export const SEED_PHRASES: readonly Omit<Phrase, "id">[] = [...BASE_SEED_PHRASES, ...NEW_SEED_PHRASES, ...STORY_SEED_PHRASES, ...MORE_STORY_SEED_PHRASES];

function readJson<T>(storage: KeyValueStorage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

const defaultStorage = (): KeyValueStorage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

/** Aggiunge alla tua libreria le frasi di partenza nuove (quelle che non hai già), una volta sola per versione. */
function withNewSeeds(phrases: Phrase[], storage: KeyValueStorage | null): Phrase[] {
  if (!storage) return phrases;
  let version = 0;
  try { version = Number(storage.getItem(LIBRARY_KEYS.seedVersion)) || 0; } catch { /* come se mancasse */ }
  if (version >= SEED_VERSION) return phrases;
  const known = new Set(phrases.map((phrase) => `${phrase.group}|${phrase.text}`));
  const fresh = [
    ...(version < 2 ? NEW_SEED_PHRASES.map((phrase, index) => ({ ...phrase, id: `seed-v2-${index}` })) : []),
    ...(version < 3 ? STORY_SEED_PHRASES.map((phrase, index) => ({ ...phrase, id: `seed-v3-${index}` })) : []),
    ...MORE_STORY_SEED_PHRASES.map((phrase, index) => ({ ...phrase, id: `seed-v4-${index}` })),
  ]
    .filter((phrase) => !known.has(`${phrase.group}|${phrase.text}`));
  const merged = [...phrases, ...fresh].slice(0, MAX_PHRASES);
  savePhrases(merged, storage);
  return merged;
}

export function loadPhrases(storage: KeyValueStorage | null = defaultStorage()): Phrase[] {
  const stored = storage ? readJson<unknown>(storage, LIBRARY_KEYS.phrases) : null;
  if (!Array.isArray(stored)) return SEED_PHRASES.map((phrase, index) => ({ ...phrase, id: `seed-${index}` }));
  return withNewSeeds(stored.flatMap((entry): Phrase[] => {
    const value = entry as Partial<Phrase> | null;
    if (!value || typeof value.text !== "string" || !value.text.trim() || typeof value.id !== "string") return [];
    return [{ id: value.id, text: value.text.slice(0, TEXT_LIMITS.textLength), group: typeof value.group === "string" && value.group.trim() ? value.group.trim().slice(0, 40) : "Le mie", ...(typeof value.styleName === "string" ? { styleName: value.styleName.slice(0, 60) } : {}) }];
  }).slice(0, MAX_PHRASES), storage);
}

export function savePhrases(phrases: readonly Phrase[], storage: KeyValueStorage | null = defaultStorage()): boolean {
  try {
    storage?.setItem(LIBRARY_KEYS.phrases, JSON.stringify(phrases.slice(0, MAX_PHRASES)));
    // Chi salva la libreria l'ha già vista com'è: le frasi di partenza nuove non devono ricomparire dopo una cancellazione.
    storage?.setItem(LIBRARY_KEYS.seedVersion, String(SEED_VERSION));
    return Boolean(storage);
  } catch { return false; }
}

export function addPhrase(phrases: readonly Phrase[], text: string, group = "Le mie", styleName?: string): Phrase[] {
  const clean = text.trim();
  if (!clean || phrases.length >= MAX_PHRASES) return [...phrases];
  if (phrases.some((phrase) => phrase.text === clean && phrase.group === group)) return [...phrases];
  return [...phrases, { id: newId("ph"), text: clean.slice(0, TEXT_LIMITS.textLength), group: group.trim().slice(0, 40) || "Le mie", ...(styleName ? { styleName } : {}) }];
}

export function updatePhrase(phrases: readonly Phrase[], id: string, patch: Partial<Pick<Phrase, "text" | "group" | "styleName">>): Phrase[] {
  return phrases.map((phrase) => {
    if (phrase.id !== id) return phrase;
    const text = patch.text !== undefined ? patch.text.trim().slice(0, TEXT_LIMITS.textLength) : phrase.text;
    return { ...phrase, text: text || phrase.text, group: patch.group !== undefined ? patch.group.trim().slice(0, 40) || phrase.group : phrase.group, ...(patch.styleName !== undefined ? { styleName: patch.styleName || undefined } : {}) };
  });
}

export const removePhrase = (phrases: readonly Phrase[], id: string): Phrase[] => phrases.filter((phrase) => phrase.id !== id);

export function phraseGroups(phrases: readonly Phrase[]): string[] {
  return [...new Set(phrases.map((phrase) => phrase.group))].sort((a, b) => a.localeCompare(b, "it"));
}

export function loadSavedStyles(storage: KeyValueStorage | null = defaultStorage()): SavedTextStyle[] {
  const stored = storage ? readJson<unknown>(storage, LIBRARY_KEYS.styles) : null;
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((entry): SavedTextStyle[] => {
    const value = entry as Partial<SavedTextStyle> | null;
    if (!value || typeof value.id !== "string" || typeof value.name !== "string" || !value.name.trim() || !value.style) return [];
    return [{ id: value.id, name: value.name.trim().slice(0, 60), style: sanitizeTextStyle(value.style) }];
  }).slice(0, MAX_SAVED_STYLES);
}

export function saveSavedStyles(styles: readonly SavedTextStyle[], storage: KeyValueStorage | null = defaultStorage()): boolean {
  try { storage?.setItem(LIBRARY_KEYS.styles, JSON.stringify(styles.slice(0, MAX_SAVED_STYLES))); return Boolean(storage); } catch { return false; }
}

/** Salva uno stile con un nome; con lo stesso nome lo sostituisce. */
export function upsertSavedStyle(styles: readonly SavedTextStyle[], name: string, style: TextStyleSpec): SavedTextStyle[] {
  const clean = name.trim().slice(0, 60);
  if (!clean) return [...styles];
  const entry: SavedTextStyle = { id: styles.find((candidate) => candidate.name.toLowerCase() === clean.toLowerCase())?.id ?? newId("st"), name: clean, style: sanitizeTextStyle(style) };
  const others = styles.filter((candidate) => candidate.id !== entry.id);
  return [...others, entry].slice(0, MAX_SAVED_STYLES);
}

export const removeSavedStyle = (styles: readonly SavedTextStyle[], id: string): SavedTextStyle[] => styles.filter((style) => style.id !== id);
