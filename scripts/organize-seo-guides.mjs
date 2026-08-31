import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("website", "guide");
const idPhotoProductHtml = await readFile(resolve("website", "strumenti", "id-photo", "index.html"), "utf8");
const idPhotoUpcomingMatch = idPhotoProductHtml.match(/in arrivo con (?:FileX )?Suite\s+([0-9]+\.[0-9]+\.[0-9]+)/i);
const idPhotoUpcomingVersion = idPhotoUpcomingMatch?.[1] ?? null;
const idPhotoUpcomingLabel = idPhotoUpcomingVersion ? ` · In arrivo con Suite ${idPhotoUpcomingVersion}` : "";
const guides = [
  ["selezionare-foto-raw", "Image Select Pro", "Selezione e classificazione", "Come selezionare foto RAW e JPEG con Image Select Pro", "Selezionare un servizio senza perdere tempo tra raffiche e scatti quasi uguali.", "Dopo l'importazione, prima di ritocco e consegna."],
  ["software-gestione-archivio-fotografico", "Archivio Flow", "Gestione dell'archivio fotografico", "Come organizzare un archivio fotografico con Archivio Flow", "Catalogare, rinominare e ritrovare ogni lavoro senza gestire l'archivio a mano da Esplora file.", "Dall'importazione della scheda alla consultazione e al backup dell'archivio."],
  ["backup-archivio-fotografico", "FileX Backup Guard", "Backup e sicurezza", "Come verificare un backup fotografico con FileX Backup Guard", "Controllare se il clone dell'archivio è davvero coerente con il master.", "Dopo le importazioni importanti e nei controlli periodici."],
  ["software-invio-file-clienti-qr", "FileX Send", "Invio e ricezione", "Come ricevere foto dai clienti con QR e link usando FileX Send", "Ricevere o consegnare foto e altri file in studio e a distanza, senza chiedere al cliente di installare un'app.", "Al banco dello studio, durante un evento o per uno scambio di file a distanza."],
  ["software-photo-booth-matrimoni-eventi", "Image Party Frame", "Photo booth per eventi", "Software per photo booth a matrimoni ed eventi: Image Party Frame", "Automatizzare il passaggio dalle foto scattate alle immagini incorniciate, pronte per stampa o pubblicazione online.", "Durante matrimoni ed eventi, dopo aver scaricato le fotografie sul PC."],
  ["impaginare-foto-per-la-stampa", "Batch Print Layout", "Impaginazione e stampa", "Come stampare più foto su un unico foglio con Batch Print Layout", "Ottimizzare carta, tempi e formati impaginando automaticamente più fotografie su ogni stampa.", "Quando il formato della stampante è più grande delle singole fotografie da consegnare."],
  ["preparare-fototessere-documenti", "FileX ID Photo", "Fototessere professionali", "Come preparare fototessere per documenti con FileX ID Photo", "Gestire crop, controlli tecnici, passaggio Photoshop e fogli 10×15 o 15×20 senza modificare l’originale.", "Quando lo studio deve preparare e impaginare fotografie per documenti d’identità."],
  ["convertire-foto-per-web-stampa-archivio", "Image Converter", "Conversione fotografica", "Come convertire foto in JPG, WebP e DNG con Image Converter", "Creare copie coerenti per web, social, stampa, revisione o archivio senza modificare gli originali.", "Dopo selezione e sviluppo, prima della pubblicazione, consegna o archiviazione."],
  ["ritrovare-foto-in-archivio", "Trova Foto da Lista", "Ricerca nell'archivio", "Come trovare le foto scelte dal cliente da un elenco", "Trasformare l'elenco scelto nella gallery online in una cartella pronta per Lightroom.", "Dopo la selezione del cliente, prima di sviluppo, ritocco o stampa."],
  ["pulire-cache-adobe-in-sicurezza", "FileX Adobe Cleaner", "Manutenzione Adobe", "Come pulire cache Adobe con FileX Adobe Cleaner", "Liberare spazio distinguendo cache ricreabili, anteprime delicate e vecchie installazioni Adobe.", "Quando il disco si riempie o durante la manutenzione della postazione Adobe."]
].map(([slug, tool, category, title, problem, when]) => ({ slug, tool, category, title, problem, when }));

const esc = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const groups = [["Dalla scheda alla selezione", guides.slice(0, 3)], ["Ricezione, produzione e stampa", guides.slice(3, 7)], ["Conversione, ricerca e manutenzione", guides.slice(7)]];

const cards = (items) => items.map((guide) => {
  const availability = guide.slug === "preparare-fototessere-documenti" ? idPhotoUpcomingLabel : "";
  return `<a class="guide-card" href="${guide.slug}/index.html"><span class="guide-product">Manuale ${esc(guide.tool)}${availability}</span><h3>${esc(guide.title)}</h3><p>${esc(guide.problem)}</p><span class="guide-link">Apri il manuale →</span></a>`;
}).join("");
const itemList = { "@context": "https://schema.org", "@type": "ItemList", itemListElement: guides.map((guide, index) => ({ "@type": "ListItem", position: index + 1, name: guide.title, url: `https://filex-suite.web.app/guide/${guide.slug}/` })) };
const index = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Manuali dei dieci software FileX per fotografi: importazione, selezione, backup, invio, cornici, fototessere, stampa, conversione, ricerca e manutenzione Adobe."><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="https://filex-suite.web.app/guide/"><link rel="icon" href="../favicon.ico"><link rel="stylesheet" href="../assets/site.css"><link rel="stylesheet" href="../assets/guides.css"><title>Manuali dei software FileX per fotografi</title><meta property="og:title" content="Manuali dei software FileX per fotografi"><meta property="og:description" content="Istruzioni operative organizzate per software e fase del lavoro fotografico."><meta property="og:type" content="website"><meta property="og:url" content="https://filex-suite.web.app/guide/"><meta property="og:image" content="https://filex-suite.web.app/og.png"><script type="application/ld+json">${JSON.stringify(itemList)}</script></head><body><header class="site-header"><nav class="wrap nav"><a class="brand" href="../index.html"><img src="../assets/icons/suite-launcher.png" width="256" height="256" alt="">FileX</a><div class="nav-links"><a href="../strumenti/index.html">Software</a><a href="../supporto/index.html">Supporto</a><a class="nav-cta" href="../index.html#download">Scarica</a></div></nav></header><main><div class="wrap crumbs"><a href="../index.html">FileX</a> / Manuali</div><section class="manual-index-hero"><div class="wrap"><div class="kicker">Guide ufficiali FileX</div><h1>Un manuale chiaro <span>per ogni software.</span></h1><p class="lead">Trova subito il tool che usi e la fase del lavoro. Ogni guida spiega preparazione, procedura, controlli e limiti.</p></div></section>${groups.map(([title, items], index) => `<section class="guide-group${index % 2 ? " alt" : ""}"><div class="wrap"><div class="section-head"><h2>${title}</h2></div><div class="guide-list">${cards(items)}</div></div></section>`).join("")}</main><footer><div class="wrap"><div class="footer-grid"><strong>FileX</strong><div class="footer-links"><a href="../strumenti/index.html">Software</a><a href="../supporto/index.html">Supporto</a><a href="../sicurezza/index.html">Sicurezza</a></div></div><div class="copyright">© 2026 FileX · Manuali revisionati il 31 agosto 2026</div></div></footer></body></html>`;
const publishedIndex = idPhotoUpcomingVersion
  ? index
    .replace(
      "Manuali dei dieci software FileX per fotografi: importazione, selezione, backup, invio, cornici, fototessere, stampa, conversione, ricerca e manutenzione Adobe.",
      `Manuali dei nove software FileX disponibili e anteprima di FileX ID Photo, in arrivo con Suite ${idPhotoUpcomingVersion}.`,
    )
    .replace(
      "Istruzioni operative organizzate per software e fase del lavoro fotografico.",
      `Guide dei tool disponibili e anteprima di FileX ID Photo, in arrivo con Suite ${idPhotoUpcomingVersion}.`,
    )
  : index;
await writeFile(resolve(root, "index.html"), publishedIndex, "utf8");

for (const guide of guides) {
  const path = resolve(root, guide.slug, "index.html");
  let html = await readFile(path, "utf8");
  const description = `Manuale di ${guide.tool} per fotografi: ${guide.problem.charAt(0).toLowerCase()}${guide.problem.slice(1)}`;
  html = html.replace(/<title>.*?<\/title>/s, `<title>${esc(guide.title)} | FileX</title>`)
    .replace(/<div class="kicker">.*?<\/div>/s, `<div class="kicker">Manuale ${esc(guide.tool)}</div>`)
    .replace(/<h1>.*?<\/h1>/s, `<h1>${esc(guide.title)}</h1>`);
  if (!html.includes('href="../../assets/guides.css"')) {
    html = html.replace('<link rel="stylesheet" href="../../assets/site.css">', '<link rel="stylesheet" href="../../assets/site.css"><link rel="stylesheet" href="../../assets/guides.css">');
  }
  if (guide.slug === "preparare-fototessere-documenti" && !html.includes('name="robots"')) {
    html = html.replace('<link rel="canonical"', '<meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical"');
  }
  if (!html.includes('class="manual-summary"')) {
    html = html.replace(/(<p class="lead">.*?<\/p>)/s, `$1<div class="manual-summary"><div><small>Software</small><strong>${esc(guide.tool)}</strong></div><div><small>Problema risolto</small><strong>${esc(guide.problem)}</strong></div><div><small>Quando usarlo</small><strong>${esc(guide.when)}</strong></div></div>`);
  }
  if (!html.includes('property="og:title"')) {
    const schema = { "@context": "https://schema.org", "@type": "TechArticle", headline: guide.title, dateModified: "2026-08-31", author: { "@type": "Person", name: "Gennaro Mazzacane" }, about: { "@type": "SoftwareApplication", name: guide.tool, operatingSystem: "Windows" } };
    html = html.replace("</head>", `<meta property="og:title" content="${esc(guide.title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="article"><meta property="og:url" content="https://filex-suite.web.app/guide/${guide.slug}/"><meta property="og:image" content="https://filex-suite.web.app/og.png"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${JSON.stringify(schema)}</script></head>`);
  }
  if (guide.slug === "preparare-fototessere-documenti" && !html.includes('name="twitter:title"')) {
    html = html.replace("</head>", `<meta name="twitter:title" content="${esc(guide.title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="https://filex-suite.web.app/og.png"></head>`);
  }
  if (guide.slug === "preparare-fototessere-documenti") {
    const idPhotoDescription = idPhotoUpcomingVersion
      ? `Anteprima del manuale di FileX ID Photo, in arrivo con Suite ${idPhotoUpcomingVersion}: crop, Photoshop, fogli 10×15 o 15×20 e verifica SHA-256 degli output.`
      : "Manuale di FileX ID Photo per fotografi: crop, Photoshop, fogli 10×15 o 15×20 e verifica SHA-256 degli output.";
    const lead = idPhotoUpcomingVersion
      ? `<p class="lead"><strong>Anteprima:</strong> FileX ID Photo non è ancora incluso nella Suite stabile ed è previsto con FileX Suite ${idPhotoUpcomingVersion}. Il flusso separa preparazione, verifica ed export, così ogni decisione resta visibile all’operatore.</p>`
      : '<p class="lead">Il flusso separa preparazione, verifica ed export, così ogni decisione resta visibile all’operatore.</p>';
    const note = idPhotoUpcomingVersion
      ? '<p class="note">Questa guida anticipa il flusso della prima release. La verifica SHA-256 riguarda l’integrità dell’output: l’esito documentale resta responsabilità dell’ente e del fotografo, mentre la resa fisica va controllata con una stampa al 100%. FileX ID Photo non è ancora scaricabile dalla Suite stabile e non effettua stampa diretta.</p>'
      : '<p class="note">La verifica SHA-256 riguarda l’integrità dell’output: l’esito documentale resta responsabilità dell’ente e del fotografo, mentre la resa fisica va controllata con una stampa al 100%. FileX ID Photo non effettua stampa diretta.</p>';
    html = html
      .replace(/<meta name="description" content=".*?">/s, `<meta name="description" content="${idPhotoDescription}">`)
      .replace(/<meta property="og:description" content=".*?">/s, `<meta property="og:description" content="${idPhotoDescription}">`)
      .replace(/<meta name="twitter:description" content=".*?">/s, `<meta name="twitter:description" content="${idPhotoDescription}">`)
      .replace(/<p class="lead">.*?<\/p>/s, lead)
      .replace(/<p class="note">.*?<\/p>/s, note)
      .replace(/(<small>Software<\/small><strong>).*?(<\/strong>)/s, `$1FileX ID Photo${idPhotoUpcomingLabel}$2`);
  }
  if (guide.slug === "software-photo-booth-matrimoni-eventi") {
    const archivioFlowParagraph = '<p>Da Archivio Flow puoi selezionare fino a 500 fotografie compatibili e aprirle direttamente in Image Party Frame, mantenendo l’ordine scelto. Il tool verifica che ogni anteprima sia decodificabile, conserva riferimenti locali invece di duplicare gli originali e segnala gli eventuali file esclusi: lascia quindi collegata la scheda fino alla conclusione dell’esportazione.</p>';
    if (!html.includes(archivioFlowParagraph)) {
      html = html.replace(
        '<p>Durante l\'evento il fotografo realizza le immagini e le trasferisce sul computer. Nell\'app desktop i file locali verificati possono essere referenziati senza duplicare l\'intero batch in memoria: l\'importazione rimane leggera anche quando il progetto si avvicina al limite reale di 500 fotografie.</p>',
        `$&${archivioFlowParagraph}`,
      );
    }
    html = html
      .replace('"dateModified":"2026-08-30"', '"dateModified":"2026-08-31"')
      .replace('Revisionato il 30 agosto 2026', 'Revisionato il 31 agosto 2026');
  }
  if (guide.slug === "impaginare-foto-per-la-stampa") {
    const archivioFlowParagraph = '<p>Se stai partendo dalla scheda, puoi selezionare fino a 500 fotografie nell’anteprima di Archivio Flow e aprirle direttamente in Batch Print Layout. La selezione mantiene il proprio ordine e rimane locale: lascia collegata la scheda fino alla conclusione dell’esportazione.</p>';
    if (!html.includes(archivioFlowParagraph)) {
      html = html.replace(
        '<p>Aggiungi le immagini finali che vuoi stampare. È consigliabile lavorare su copie già selezionate e sviluppate, mantenendo separati gli originali. Il programma calcola la griglia, il numero di foto per foglio e il numero complessivo di pagine necessarie.</p>',
        `$&${archivioFlowParagraph}`,
      );
    }
    html = html
      .replace('"dateModified":"2026-08-25"', '"dateModified":"2026-08-31"')
      .replace('Revisionato il 25 agosto 2026', 'Revisionato il 31 agosto 2026');
  }
  await writeFile(path, html, "utf8");
}
console.log(`Riorganizzati indice e ${guides.length} manuali.`);
