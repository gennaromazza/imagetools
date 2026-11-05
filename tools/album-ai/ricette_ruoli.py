"""Ricette di Gennaro per le schede con il campo «ruolo» (prova definitiva, 2026-11-05).

Ogni funzione riceve le foto utilizzabili di un capitolo e restituisce (specs, usate, escluse):
- specs: doppie già decise. {"pagine": [sinistra, destra]} fissa le due pagine; {"gruppo": [...]} lascia al motore
  la disposizione. "ultima": True le mette in fondo al capitolo (finale).
- escluse: foto che non devono tornare nel racconto libero (per esempio tutti i dettagli: stanno nelle loro pagine).

Regole (dette da Gennaro):
- Casa: mezza facciata con i dettagli, dall'altra parte una foto più stretta e grande dello sposo/della sposa.
  I dettagli non si mescolano con i ritratti nel resto del capitolo. I gruppetti in posa stanno insieme.
- Chiesa: dettagli di tipi diversi a sinistra + grandangolo dal fondo a destra; foglio con firme a sinistra e gruppi
  all'altare a destra; foglio con gli sposi all'altare e l'uscita lungo la navata; foglio dell'uscita fuori;
  il gruppone con più spazio (accanto al rinfresco).
- Ristorante: a sinistra i dettagli, a destra l'arrivo (e il brindisi di benvenuto); poi la festa senza dettagli;
  torta: un foglio con i soli sposi (taglio, brindisi, fontane), un foglio con testimoni, genitori e regali.
"""
import re

DETTAGLI = {"dettaglio", "dettaglio-chiesa"}


def colore(s):
    return not s.get("biancoNero")


def migliori(foto, n, chiave=None):
    foto = [s for s in foto if not s.get("_alt")]
    scelte = sorted(foto, key=chiave or (lambda s: -s["punti"]))[:n]
    return sorted(scelte, key=lambda s: s["orario"])


def vari(foto, n, famiglie):
    """Le n migliori, al più una per famiglia (regex sull'espressione) finché ce ne sono di famiglie diverse."""
    scelte, viste = [], set()
    ordinate = sorted((s for s in foto if not s.get("_alt")), key=lambda s: -s["punti"])
    for s in ordinate:
        f = next((k for k, r in famiglie.items() if re.search(r, s["espressione"].lower())), s["espressione"].split()[0])
        if f in viste:
            continue
        viste.add(f)
        scelte.append(s)
        if len(scelte) == n:
            break
    for s in ordinate:
        if len(scelte) >= n:
            break
        if s not in scelte:
            scelte.append(s)
    return sorted(scelte, key=lambda s: s["orario"])


FAM_DETTAGLI = {
    "partecipazione": r"partecip|fedi|monogramm|biscott|bomboni",
    "scarpe": r"scarp",
    "abito": r"abito|corpett|velo|pizzo",
    "capelli": r"acconc|capell|fermagl",
    "divisa": r"divisa|berrett|sciabol|giacca|manica|guant",
    "fiori": r"fior|piante|mazz",
    "dolci": r"pasticc|dolci|confett",
    "casa": r"ingresso|specchio|tavolo",
    "auto": r"auto",
}


def pagina_ritratto(foto):
    """Pagina destra della doppia dei dettagli: lo sposo/la sposa mentre si prepara (non ancora vestito: il racconto
    va avanti in ordine), una foto orizzontale stretta o due verticali."""
    rit = [s for s in foto if s.get("ruolo") == "vestizione" and colore(s) and s["tipo"] != "dettaglio" and not s.get("_alt")]
    orizz = sorted((s for s in rit if s["o"] == "o" and s["tipo"] in ("ritratto", "mezzo busto")), key=lambda s: -s["punti"])
    if orizz:
        return [orizz[0]]
    vert = sorted((s for s in rit if s["o"] == "v"), key=lambda s: (-(s["tipo"] in ("ritratto", "mezzo busto")), -s["punti"]))
    return sorted(vert[:2], key=lambda s: s["orario"])


def casa(foto, posa_fn):
    specs, usate = [], set()
    dett = [s for s in foto if s.get("ruolo") == "dettaglio" and colore(s) and s["forza"] >= 3]
    destra = pagina_ritratto(foto)
    if len(dett) >= 2 and destra:
        sinistra = vari(dett, 6, FAM_DETTAGLI)
        specs.append({"ricetta": "dettagli e ritratto", "tempo": min(s["orario"] for s in sinistra + destra),
                      "pagine": [sinistra, destra]})
    fisse = {s["nome"] for sp in specs for pg in sp["pagine"] for s in pg}
    p_specs, p_usate, p_escl = posa_fn([s for s in foto if s["nome"] not in fisse])
    specs += p_specs
    for sp in specs:
        usate |= {s["nome"] for s in sp.get("gruppo", []) + [x for pg in sp.get("pagine", []) for x in pg]}
    # Nessun dettaglio nel racconto libero: stanno nella loro mezza facciata.
    escluse = {s["nome"] for s in foto if s["tipo"] == "dettaglio" or s.get("ruolo") in DETTAGLI} | p_escl
    return specs, usate, escluse


FAM_CHIESA = {
    "esterno": r"facciata|portale|scalinat|piazza",
    "banco": r"ventagl|librett",
    "altare": r"altare|calice|ampoll",
}


def chiesa(foto, obbligatoria, senza_ripetizioni):
    ordinate = sorted(foto, key=lambda s: s["orario"])
    specs, escluse = [], set()
    firme = [s for s in ordinate if s.get("ruolo") == "firme"]
    t_firme = firme[0]["orario"] if firme else "9"
    uscita = [s for s in ordinate if s.get("ruolo") == "uscita-chiesa"]
    t_uscita = uscita[0]["orario"] if uscita else "9"

    # 1. Durante il rito: dettagli di tipi diversi a sinistra, grandangolo dal fondo a destra.
    dett = [s for s in ordinate if s.get("ruolo") == "dettaglio-chiesa" and colore(s)]
    pano = sorted((s for s in ordinate if s.get("ruolo") == "chiesa-intera" and s["o"] == "o"), key=lambda s: -s["punti"])
    if dett and pano:
        sx = vari(dett, 5, FAM_CHIESA)
        # Va all'inizio del rito, subito dopo l'ingresso e la consegna della sposa (come nell'impaginato di Gennaro).
        rito = [s for s in ordinate if s.get("ruolo") == "rito" and s["orario"] < t_firme]
        tempo = rito[0]["orario"] if rito else pano[0]["orario"]
        specs.append({"ricetta": "dettagli della chiesa e grandangolo dal fondo", "tempo": tempo,
                      "pagine": [sx, [pano[0]]]})
    escluse |= {s["nome"] for s in dett} | {s["nome"] for s in ordinate if s.get("ruolo") == "chiesa-intera"}

    # 1b. Gli invitati e i parenti nei banchi, con gli sposi seduti: un foglio intero ricco (fino a 11 foto).
    ospiti = [s for s in ordinate if s.get("ruolo") in ("invitati", "parenti") and s["orario"] < t_firme and s["forza"] >= 2]
    seduti = [s for s in ordinate if s.get("ruolo") == "rito" and s["orario"] < t_firme and s["tipo"] != "dettaglio"
              and re.search(r"sedut|si guardano|ridono|ride|inginocch|sorrid", s["espressione"].lower())]
    if len(ospiti) >= 4:
        coppia = migliori(seduti, 4)
        scelte = sorted(migliori(ospiti, 11 - len(coppia)) + coppia, key=lambda s: s["orario"])
        specs.append({"ricetta": "invitati e sposi durante il rito", "tempo": (coppia or scelte)[0]["orario"], "gruppo": scelte})
        escluse |= {s["nome"] for s in ospiti + seduti}

    # 2. Firme a sinistra (sposi e testimoni), gruppi all'altare a destra.
    altare = [s for s in ordinate if t_firme <= s["orario"] < t_uscita]
    if firme:
        sx = migliori(firme, 6, lambda s: (-("sposa" in s["espressione"] or "sposo" in s["espressione"]), -s["punti"]))
        gruppi = [s for s in altare if s["tipo"] == "gruppo" and (obbligatoria(s) or s.get("ruolo") == "gruppo-posa")]
        dx = senza_ripetizioni(gruppi, 1)[:4]
        if dx:
            specs.append({"ricetta": "firme e gruppi all'altare", "tempo": t_firme, "pagine": [sx, dx]})
        else:
            specs.append({"ricetta": "firme", "tempo": t_firme, "gruppo": sx})
    # 3. Gli sposi all'altare e l'uscita lungo la navata.
    sposi = [s for s in altare if s.get("ruolo") == "gruppi-altare" and s["forza"] >= 3]
    if sposi:
        specs.append({"ricetta": "sposi all'altare e uscita dalla navata", "tempo": sposi[0]["orario"], "gruppo": migliori(sposi, 6)})
    escluse |= {s["nome"] for s in altare}

    # 4. L'uscita fuori (davanti e dietro), poi il gruppone grande accanto al rinfresco.
    dopo = [s for s in ordinate if s["orario"] >= t_uscita]
    if uscita:
        # Un foglio tutto a colori o tutto in bianco e nero: le foto a colori se bastano.
        col = [s for s in uscita if colore(s)]
        specs.append({"ricetta": "uscita degli sposi", "tempo": t_uscita, "gruppo": migliori(col if len(col) >= 4 else uscita, 7)})
    gruppone = sorted((s for s in dopo if s.get("ruolo") == "gruppo-posa" and s["o"] == "o"), key=lambda s: -s["punti"])
    rinfresco = [s for s in dopo if s.get("ruolo") == "rinfresco" and colore(s)]
    if gruppone:
        sx = migliori([s for s in rinfresco if s["tipo"] != "dettaglio"], 2) + migliori([s for s in rinfresco if s["tipo"] == "dettaglio"], 2)
        sx.sort(key=lambda s: s["orario"])
        specs.append({"ricetta": "rinfresco e gruppone", "tempo": gruppone[0]["orario"],
                      "pagine": [sx, [gruppone[0]]] if sx else [[gruppone[0]]]})
    elif rinfresco:
        specs.append({"ricetta": "rinfresco", "tempo": rinfresco[0]["orario"], "gruppo": migliori(rinfresco, 4)})
    escluse |= {s["nome"] for s in dopo}
    # Nel rito libero niente dettagli (mani, piedi): solo persone, in ordine.
    escluse |= {s["nome"] for s in ordinate if s["tipo"] == "dettaglio"}
    usate = {s["nome"] for sp in specs for s in sp.get("gruppo", []) + [x for pg in sp.get("pagine", []) for x in pg]}
    return specs, usate, escluse


FAM_RISTORANTE = {
    "vista": r"golfo|vista|panoram",
    "tableau": r"tableau",
    "tavolo": r"tavol|centrotavol|candel|segnapost|segnatavol|rose",
    "neon": r"neon|scritta",
    "cibo": r"paella|ostric|carne|cesti|buffet|marmellat",
    "calici": r"calic|spumant",
    "sala": r"sala",
    "paesaggio": r"gabbian|scoglier|cielo",
}


def ristorante(foto, obbligatoria, senza_ripetizioni):
    ordinate = sorted(foto, key=lambda s: s["orario"])
    specs, escluse = [], set()
    torta = [s for s in ordinate if s.get("ruolo") == "torta"]
    t_torta = torta[0]["orario"] if torta else "9"
    prima = [s for s in ordinate if s["orario"] < t_torta]

    # 1. Apertura del ricevimento: dettagli a sinistra, arrivo degli sposi a destra.
    dett = [s for s in prima if (s["tipo"] == "dettaglio" or s.get("ruolo") == "dettaglio") and colore(s) and s["forza"] >= 3]
    arrivo = [s for s in prima if s.get("ruolo") == "ricevimento"]
    if dett and arrivo:
        # I paesaggi degli esterni (gabbiano, scogliera) stanno qui, non su un foglio loro.
        paes = [s for s in dett if s["momento"] == "ritratti di coppia"]
        sx = sorted(paes + [s for s in vari([s for s in dett if s not in paes], 8 - len(paes), FAM_RISTORANTE)], key=lambda s: s["orario"])
        dx = [arrivo[0]]
        if arrivo[0]["o"] == "v":
            # una verticale da sola non riempie la pagina: le si affianca il momento successivo
            dopo = [s for s in prima if s["orario"] > arrivo[0]["orario"] and s not in dett and s["tipo"] != "dettaglio"
                    and s.get("ruolo") not in ("dettaglio",)]
            if dopo:
                dx.append(dopo[0])
        specs.append({"ricetta": "dettagli del ristorante e arrivo", "tempo": arrivo[0]["orario"], "pagine": [sx, dx],
                      "prima": True})
    escluse |= {s["nome"] for s in ordinate if s["tipo"] == "dettaglio" or s.get("ruolo") == "dettaglio"}

    # 2. Torta: un foglio con i soli sposi, poi testimoni, genitori e regali.
    if torta:
        sposi = [s for s in torta if s["tipo"] != "dettaglio"]
        specs.append({"ricetta": "taglio della torta", "tempo": t_torta, "gruppo": migliori(sposi, 7), "ultima": True})
        dopo = [s for s in ordinate if s["orario"] >= t_torta]
        famiglie = senza_ripetizioni([s for s in dopo if obbligatoria(s)], 2)
        brindisi = [s for s in famiglie if "brind" in s["espressione"]]
        bomboniere = [s for s in ordinate if s["tipo"] == "dettaglio" and "bombonier" in s["espressione"] + " " + s["note"]
                      or "confett" in s["espressione"]][-2:]
        regali = [s for s in famiglie if s not in brindisi] + migliori([s for s in torta if s["tipo"] == "dettaglio"], 2) \
            + [s for s in bomboniere if s["orario"] >= prima[-1]["orario"][:11] + "21:00"]
        if brindisi and regali:
            specs.append({"ricetta": "brindisi con i genitori, testimoni e regali", "tempo": brindisi[0]["orario"],
                          "pagine": [brindisi, sorted(regali, key=lambda s: s["orario"])], "ultima": True})
        elif brindisi or regali:
            specs.append({"ricetta": "brindisi e regali", "tempo": (brindisi or regali)[0]["orario"],
                          "gruppo": sorted(brindisi + regali, key=lambda s: s["orario"]), "ultima": True})
        escluse |= {s["nome"] for s in dopo}
    usate = {s["nome"] for sp in specs for s in sp.get("gruppo", []) + [x for pg in sp.get("pagine", []) for x in pg]}
    return specs, usate, escluse


def esterni(foto):
    """Esterni: i dettagli (bouquet, mani, paesaggi) restano nel racconto, tra le foto della coppia."""
    return [], set(), set()
