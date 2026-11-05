"""Motore a regole: dalle schede delle foto (analisi AI) e dal profilo di stile genera il piano dell'album.

L'AI serve solo una volta, per le schede. Scelta delle foto, ritmo, disposizioni e controlli li fa questo codice,
seguendo stile-gennaro.json: nessun token speso per impaginare e le regole valgono sempre.

Uso: python motore_stile.py [--profilo stile-gennaro.json] [--uscita piano-album-stile.json]
"""
import argparse
import re
import itertools
import json
import math
from datetime import datetime
from pathlib import Path
import sys

import ricette
import simili

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI))
from dati import DATI  # noqa: E402


# ---------------------------------------------------------------------------
# Dati
# ---------------------------------------------------------------------------

def carica(profilo_path):
    profilo = json.loads(Path(profilo_path).read_text(encoding="utf-8"))
    schede = json.loads((DATI / "schede.json").read_text(encoding="utf-8"))
    foto = {f["nome"]: f for f in json.loads((DATI / "provini" / "foto.json").read_text(encoding="utf-8"))}
    for s in schede:
        f = foto[s["nome"]]
        lungo, corto = max(f["larghezza"] or 3, f["altezza"] or 2), min(f["larghezza"] or 3, f["altezza"] or 2)
        s["aspect"] = lungo / corto if s["orientamento"] == "orizzontale" else corto / lungo
        s["o"] = "o" if s["orientamento"] == "orizzontale" else "v"
        s["punti"] = s["forza"] + (0.5 if s["paginaPiena"] else 0) - (0.5 if "variante" in s["note"] else 0)
        s["eroe"] = s["forza"] == 5 and s["o"] == "o"
    return profilo, schede, foto


INIZIO_CHIESA = "15:30"


RELAZIONI = r"madre|mamma|padre|pap[aà]|sorell|fratell|testimon|suocer|genitor|nonn"


def relazione(s):
    """Con chi sono gli sposi nella foto (solo per i momenti con i parenti): madre, padre, sorella…"""
    if s.get("ruolo") not in ("con-parenti", "bouquet-suocera"):
        return None
    return tuple(sorted(set(re.findall(RELAZIONI, s["espressione"].lower()))))


def capitolo_di(s):
    # Data e ora insieme: le foto dopo mezzanotte appartengono comunque alla sera.
    m, ora = s["momento"], s["orario"][:16]
    giorno = s["orario"][:10] if s["orario"][11:13] >= "06" else None
    if m == "preparazione sposo":
        return "casa-sposo"
    if m == "preparazione sposa":
        return "casa-sposa"
    if m == "uscita":
        return "casa-sposa" if giorno and ora[11:] < INIZIO_CHIESA else "chiesa"
    if m == "cerimonia":
        return "chiesa"
    if m == "ritratti di coppia":
        if s.get("ruolo") == "dettaglio" and not re.search(r"mani|bouquet", s["espressione"].lower()):
            return "ristorante"
        return "esterni"
    if m == "ricevimento":
        return "chiesa" if giorno and ora[11:] < "18:00" else "ristorante"
    return None


# ---------------------------------------------------------------------------
# Disposizioni: colonne affiancate (verticale da sola, orizzontali impilate a 2-3), come nei tuoi album
# ---------------------------------------------------------------------------

def composizioni(n, max_parte=3):
    if n == 0:
        yield []
        return
    for k in range(1, min(max_parte, n) + 1):
        for resto in composizioni(n - k, max_parte):
            yield [k] + resto


def leggi_firma(f, rapp):
    """Da «R(v,C(o,o))» e dai rapporti in preordine a un albero con l'orientamento richiesto in ogni foglia."""
    pos, ri = [0], [0]

    def nodo():
        c = f[pos[0]]
        if c in "ov":
            pos[0] += 1
            return {"kind": "leaf", "o": c}
        pos[0] += 2
        r = rapp[ri[0]]
        ri[0] += 1
        a = nodo()
        pos[0] += 1
        b = nodo()
        pos[0] += 1
        return {"kind": "split", "dir": "row" if c == "R" else "column", "ratio": r, "first": a, "second": b}
    return nodo()


def specchio(n):
    if n["kind"] == "leaf":
        return dict(n)
    a, b = specchio(n["first"]), specchio(n["second"])
    if n["dir"] == "row":
        return {**n, "ratio": 1 - n["ratio"], "first": b, "second": a}
    return {**n, "first": a, "second": b}


def foglie(n):
    return [n] if n["kind"] == "leaf" else foglie(n["first"]) + foglie(n["second"])


def carica_modelli(profilo):
    v = profilo.get("varieta", {})
    path = QUI / v.get("modelli", "stile/modelli.json")
    out = []
    if not path.exists():
        return out
    for m in json.loads(path.read_text(encoding="utf-8")):
        base = leggi_firma(m["firma"], m["rapporti"])
        varianti = [("tuo", m["id"], base)]
        mir = specchio(base)
        if json.dumps(mir, sort_keys=True) != json.dumps(base, sort_keys=True):
            varianti.append(("specchio", m["id"] + "s", mir))
        for tipo, mid, albero_m in varianti:
            ori = "".join(sorted(x["o"] for x in foglie(albero_m)))
            out.append({"tipo": tipo, "id": mid, "firma": firma_nodo(albero_m), "usi": m["usi"], "album": m["album"], "target": m["target"],
                        "ori": ori, "albero": albero_m})
    return out


def ordine_o(n):
    return [n["o"]] if n["kind"] == "leaf" else ordine_o(n["first"]) + ordine_o(n["second"])


def assegna(modello, foto):
    """Copia dell'albero con le foto nelle foglie: verticali e orizzontali nell'ordine dello scatto."""
    code = {"o": [s for s in foto if s["o"] == "o"], "v": [s for s in foto if s["o"] == "v"]}

    def copia(n):
        if n["kind"] == "leaf":
            return {"kind": "leaf", "s": code[n["o"]].pop(0)}
        return {**n, "first": copia(n["first"]), "second": copia(n["second"])}
    return copia(modello)


def naturale(n):
    if n["kind"] == "leaf":
        return n["s"]["aspect"]
    a, b = naturale(n["first"]), naturale(n["second"])
    return a + b if n["dir"] == "row" else 1 / (1 / a + 1 / b)


def fissa_rapporti(n, miscela):
    """Rapporti tra quelli del tuo modello (gerarchia, foto grande) e quelli che rispettano le proporzioni delle foto."""
    if n["kind"] == "leaf":
        return n
    a, b = naturale(n["first"]), naturale(n["second"])
    rn = a / (a + b) if n["dir"] == "row" else (1 / a) / (1 / a + 1 / b)
    r = miscela * n["ratio"] + (1 - miscela) * rn
    return {**n, "ratio": round(min(0.85, max(0.15, r)), 4),
            "first": fissa_rapporti(n["first"], miscela), "second": fissa_rapporti(n["second"], miscela)}


def celle_di(n, x, y, w, h, out):
    if n["kind"] == "leaf":
        out.append((n["s"], x, y, w, h))
        return out
    r = n["ratio"]
    if n["dir"] == "row":
        celle_di(n["first"], x, y, w * r, h, out)
        celle_di(n["second"], x + w * r, y, w * (1 - r), h, out)
    else:
        celle_di(n["first"], x, y, w, h * r, out)
        celle_di(n["second"], x, y + h * r, w, h * (1 - r), out)
    return out


def peso_taglio(s, w, h):
    """Quanto pesa il ritaglio di una foto nella sua cella. Tagliare sopra e sotto una figura intera o un gruppo
    (piedi, teste) pesa il triplo che tagliare ai lati."""
    r = math.log((w / h) / s["aspect"])
    if r > 0 and s["tipo"] in ("figura intera", "gruppo"):
        return 3 * r
    return abs(r)


def miglior_fit(foto, target):
    """Disposizione a colonne con proporzioni naturali più vicina a quella dell'area (meno bianco attorno)."""
    migliore = None
    for parti in composizioni(len(foto)):
        colonne, i = [], 0
        for k in parti:
            colonne.append(foto[i:i + k])
            i += k
        nodo = a_colonne(colonne)
        d = abs(math.log(naturale(nodo) / target))
        if migliore is None or d < migliore[0]:
            migliore = (d, nodo)
    return migliore[1]


def taglia_troppo(n, target):
    """Vero se una foto perde mani, piedi o teste (figura intera o gruppo tagliati sopra/sotto più del 12%)
    o se il ritaglio cambia troppo la proporzione (più del 30% ai lati per le figure, del 35% per le altre)."""
    celle = [(n["s"], 0, 0, target, 1)] if n["kind"] == "leaf" else celle_di(n, 0, 0, target, 1, [])
    for s, x, y, w, h in celle:
        r = math.log((w / h) / s["aspect"])
        if s["tipo"] in ("figura intera", "gruppo"):
            if r > 0.18 or r < -0.4:
                return True
        elif abs(r) > 0.45:
            return True
    return False


def taglio_massimo(n, target):
    """Ritaglio più forte (in proporzione) tra le foto di un albero disposto in un'area di proporzione `target`."""
    if n["kind"] == "leaf":
        return abs(math.log(target / n["s"]["aspect"]))
    return max(abs(math.log((w / h) / s["aspect"])) for s, x, y, w, h in celle_di(n, 0, 0, target, 1, []))


def valuta(n, target, piega):
    """Costo di un albero già con i rapporti: ritaglio medio e peggiore, piega, foto principale nella cella grande."""
    c = celle_di(n, 0, 0, target, 1, [])
    tagli = [peso_taglio(s, w, h) for s, x, y, w, h in c]
    media = sum(tagli) / len(tagli)
    costo = media + 0.3 * (max(tagli) - media)
    # Oltre il 20% di taglio la foto perde la sua proporzione: soluzione da evitare.
    if max(abs(math.log((w / h) / s["aspect"])) for s, x, y, w, h in c) > 0.2:
        costo += 1.0
    # Mani e piedi tagliati (o margine bianco per evitarlo): da scartare se c'è un'alternativa.
    if taglia_troppo(n, target):
        costo += 2.5
    if piega:
        for s, x, y, w, h in c:
            if x < target / 2 < x + w and 0.2 < (target / 2 - x) / w < 0.8:
                costo += 0.6
    if len(c) >= 3:
        aree = [w * h for s, x, y, w, h in c]
        principale = max(range(len(c)), key=lambda i: c[i][0]["punti"])
        costo += 0.15 * (1 - aree[principale] / max(aree))
    return costo


def firma_nodo(n):
    if n["kind"] == "leaf":
        return n["s"]["o"] if "s" in n else n["o"]
    return ("R(" if n["dir"] == "row" else "C(") + firma_nodo(n["first"]) + "," + firma_nodo(n["second"]) + ")"


def a_colonne(colonne):
    def catena(nodi, pesi, direzione):
        if len(nodi) == 1:
            return nodi[0]
        resto = sum(pesi[1:])
        return {"kind": "split", "dir": direzione, "ratio": round(pesi[0] / (pesi[0] + resto), 4),
                "first": nodi[0], "second": catena(nodi[1:], pesi[1:], direzione)}
    nodi, pesi = [], []
    for g in colonne:
        nodi.append(catena([{"kind": "leaf", "s": x} for x in g], [1 / x["aspect"] for x in g], "column"))
        pesi.append(1 / sum(1 / x["aspect"] for x in g))
    return catena(nodi, pesi, "row")


class Varieta:
    """Stato condiviso del motore: modelli, composizioni usate di recente, doppie che cercano qualcosa di nuovo."""

    def __init__(self, profilo):
        import random
        v = profilo.get("varieta", {})
        self.modelli = carica_modelli(profilo)
        self.quota = v.get("quotaNovita", 0.25)
        self.distanza = v.get("distanzaStessoModello", 4)
        self.peso = v.get("pesoTuoiModelli", 0.1)
        self.miscela = v.get("miscelaRapporti", 0.5)
        self.rng = random.Random(v.get("seme", 7))
        self.storia = []
        self.novita = False
        self.conta = {"tuo": 0, "specchio": 0, "nuovo": 0}

    def nuova_doppia(self):
        self.novita = self.rng.random() < self.quota

    def usa(self, nodo):
        o = nodo.get("origine")
        if o:
            self.storia.append(o["chiave"])
            self.conta[o["tipo"]] += 1


VARIETA = None


def miglior_area(foto, target, piega=False):
    """Restituisce (costo, albero) per un'area di proporzione `target`: tuoi modelli, a specchio o colonne nuove."""
    if len(foto) == 1:
        return 0.0, {"kind": "leaf", "s": foto[0]}
    var = VARIETA
    recenti = set(var.storia[-var.distanza:]) if var else set()
    candidati = []
    tgt = "full" if piega else "page"
    ori = "".join(sorted(s["o"] for s in foto))
    if var:
        for m in var.modelli:
            if m["target"] != tgt or m["ori"] != ori:
                continue
            # Ordine cronologico prima di tutto: il modello deve leggere le foto nell'ordine in cui sono state scattate.
            if ordine_o(m["albero"]) != [s["o"] for s in foto]:
                continue
            nodo = fissa_rapporti(assegna(m["albero"], foto), var.miscela)
            bonus = -var.peso * (1 if m["tipo"] == "tuo" else 0.6) * (1 + 0.3 * math.log(m["usi"]))
            if var.novita:
                bonus = -bonus
            candidati.append((valuta(nodo, target, piega) + bonus, nodo,
                              {"tipo": m["tipo"], "id": m["id"].rstrip("s"), "chiave": m["id"], "usi": m["usi"], "album": m["album"]}))
    for parti in composizioni(len(foto)):
        colonne, i, ok = [], 0, True
        for k in parti:
            g = foto[i:i + k]
            i += k
            if k > 1 and any(x["o"] == "v" for x in g):
                ok = False
                break
            colonne.append(g)
        if not ok:
            continue
        nodo = a_colonne(colonne)
        if var and any(m["target"] == tgt and m["firma"] == firma_nodo(nodo) for m in var.modelli):
            continue  # è già una tua composizione: la valuta il modello
        chiave = "nuovo:" + forma(nodo)
        candidati.append((valuta(nodo, target, piega), nodo, {"tipo": "nuovo", "id": forma(nodo), "chiave": chiave}))
    if not candidati:
        return math.inf, None
    migliore = None
    for costo, nodo, origine in candidati:
        if origine["chiave"] in recenti:
            costo += 0.3
        if migliore is None or costo < migliore[0]:
            migliore = (costo, {**nodo, "origine": origine})
    return migliore


def albero(nodo, item_id):
    if nodo["kind"] == "leaf":
        return {"kind": "leaf", "itemId": item_id(nodo["s"])}
    return {"kind": "split", "dir": nodo["dir"], "ratio": nodo["ratio"],
            "first": albero(nodo["first"], item_id), "second": albero(nodo["second"], item_id)}


def forma(n):
    return "o" if n["kind"] == "leaf" else ("R(" if n["dir"] == "row" else "C(") + forma(n["first"]) + "," + forma(n["second"]) + ")"


# ---------------------------------------------------------------------------
# Motore
# ---------------------------------------------------------------------------

def scene_di(foto, pausa):
    """Scene: foto consecutive senza pause più lunghe di `pausa` secondi."""
    ordinate = sorted(foto, key=lambda s: s["orario"])
    t = lambda s: datetime.strptime(s["orario"][:19], "%Y-%m-%d %H:%M:%S")
    scene = []
    for a, b in zip([None] + ordinate, ordinate):
        if a is None or (t(b) - t(a)).total_seconds() > pausa:
            scene.append([])
        scene[-1].append(b)
    return scene


def limita_scene(candidati, profilo, fattore=1.0):
    """Tiene al massimo (base + minuti × fotoPerMinuto) × fattore foto per scena, le più forti; l'ordine per forza resta."""
    sc = profilo.get("scene")
    if not sc:
        return candidati
    t = lambda s: datetime.strptime(s["orario"][:19], "%Y-%m-%d %H:%M:%S")
    tenute = set()
    for scena in scene_di(candidati, sc["pausaSecondi"]):
        minuti = (t(scena[-1]) - t(scena[0])).total_seconds() / 60
        tetto = round((sc["fotoBase"] + sc["fotoPerMinuto"] * minuti) * fattore)
        for s in sorted(scena, key=lambda s: -s["punti"])[:tetto]:
            s["scena"] = f"{scena[0]['orario'][11:16]}-{scena[-1]['orario'][11:16]}"
            s["tettoScena"] = tetto
            tenute.add(s["nome"])
    return [s for s in candidati if s["nome"] in tenute]


def ripartisci(capitoli, per_cap, obiettivo, massimo, media, fisse=None):
    """Doppie per capitolo dentro gli intervalli del profilo (com'è fatto di solito un tuo matrimonio).
    Si parte dal minimo di ogni capitolo; fino all'obiettivo le doppie vanno ai capitoli con più foto buone avanzate,
    senza superare il loro massimo; oltre l'obiettivo (fino al massimo dell'album) solo se restano molte foto belle (forza 4+),
    e al più una doppia oltre il massimo del capitolo."""
    n = {c["id"]: c["doppie"]["min"] for c in capitoli}
    fisse = fisse or {}
    # Ogni capitolo ha il suo passo (esterne: poche foto grandi; festa: fogli ricchi), come nell'impaginato finale di Gennaro.
    avanzo = lambda c, soglia=3: sum(1 for s in per_cap[c["id"]] if s["forza"] >= soglia) / c.get("fotoPerDoppia", media) \
        - (n[c["id"]] - fisse.get(c["id"], 0))
    while sum(n.values()) < obiettivo:
        liberi = [c for c in capitoli if n[c["id"]] < c["doppie"]["max"] and avanzo(c) >= 1]
        if not liberi:
            break
        n[max(liberi, key=avanzo)["id"]] += 1
    while sum(n.values()) < massimo:
        liberi = [c for c in capitoli if n[c["id"]] < c["doppie"]["max"] + 1 and avanzo(c, 4) >= 1]
        if not liberi:
            break
        n[max(liberi, key=lambda c: avanzo(c, 4))["id"]] += 1
    return n


def adatta_ritmo(dimensioni, disponibili):
    """Meno foto per doppia quando il capitolo deve avere più doppie che foto diverse: stessa forma del ritmo, minimo 3
    (le doppie leggere da 2 restano tali)."""
    while sum(dimensioni) > disponibili:
        i = max(range(len(dimensioni)), key=lambda i: dimensioni[i])
        if dimensioni[i] <= 3:
            break
        dimensioni[i] -= 1
    return dimensioni


AZIONI = {"bacio": ("bacio", "bacia"), "abbraccio": ("abbracc",), "risata": ("ride", "risat", "sorris"),
          "fronte": ("fronte",), "naso": ("naso",), "mano": ("mano", "mani"), "casqué": ("casqu",),
          "in braccio": ("solleva", "in braccio"), "giro": ("gira",), "cammino": ("cammin", "passegg"),
          "di spalle": ("spalle",), "seduti": ("sedut",), "sguardo": ("sguard", "guarda", "occhi")}


def azioni(testo):
    t = testo.lower()
    return {k for k, parole in AZIONI.items() if any(p in t for p in parole)}


def ts(s):
    return datetime.strptime(s["orario"][:19], "%Y-%m-%d %H:%M:%S")


IMPRONTE = None


def simili_larghi(a, b, d):
    """Foto che si somigliano abbastanza da sembrare ripetute se stanno su fogli diversi."""
    global IMPRONTE
    if IMPRONTE is None:
        IMPRONTE = simili.carica_impronte()
    if a["nome"] not in IMPRONTE or b["nome"] not in IMPRONTE:
        return False
    if abs((ts(a) - ts(b)).total_seconds()) > d["secondi"]:
        return False
    ia, ib = IMPRONTE[a["nome"]], IMPRONTE[b["nome"]]
    return simili.distanza(ia[0], ib[0]) <= d["hash"] and simili.colore(ia[1], ib[1]) <= d["colore"]


def scegli_sequenze(profilo, schede, gruppi):
    """Raffiche belle: al massimo `max` per album e una per capitolo, 3-4 foto dello stesso orientamento scattate in pochi
    secondi. Stanno insieme su una pagina sola, in bianco e nero (blocco «seq-N»)."""
    cfg = profilo.get("sequenze")
    if not cfg or cfg.get("max", 0) <= 0:
        return []
    per = {s["nome"]: s for s in schede}
    cand = []
    for g in gruppi:
        buone = [per[n] for n in g if per[n]["forza"] >= 3 and not per[n]["orientamentoDaCorreggere"]
                 and per[n].get("ruolo", "ritratto") in ("ritratto", "coppia", "spontanea", "vestizione")
                 and capitolo_di(per[n]) not in ("chiesa", "ristorante")]
        if len(buone) < cfg["foto"]["min"]:
            continue
        o = max("ov", key=lambda x: sum(s["o"] == x for s in buone))
        buone = [s for s in buone if s["o"] == o]
        membri = sorted(sorted(buone, key=lambda s: -s["forza"])[:cfg["foto"]["max"]], key=lambda s: s["orario"])
        if len(membri) < cfg["foto"]["min"] or (ts(membri[-1]) - ts(membri[0])).total_seconds() > cfg["durataMassimaSecondi"]:
            continue
        cand.append((sum(s["forza"] for s in membri) / len(membri) + 0.1 * len(membri), membri))
    cand.sort(key=lambda c: -c[0])
    scelte, per_cap = [], {}
    for _, membri in cand:
        c = capitolo_di(membri[0])
        if per_cap.get(c, 0) >= cfg["perCapitolo"]:
            continue
        per_cap[c] = per_cap.get(c, 0) + 1
        scelte.append(membri)
        if len(scelte) >= cfg["max"]:
            break
    for i, membri in enumerate(scelte, 1):
        for s in membri:
            s["blocco"], s["sequenza"] = f"seq-{i}", True
    return scelte


def seleziona(candidati, quante, tutte_cap, d, gia=()):
    """Sceglie per forza, a unità: una foto sola o un blocco intero (sequenza, foto + variante).
    Una foto che somiglia a una già presa in un'altra unità resta fuori: niente foto simili su fogli diversi."""
    membri = {}
    for s in tutte_cap:
        if s.get("blocco"):
            membri.setdefault(s["blocco"], []).append(s)
    prese, n, visti = [], 0, set()
    fisse = [list(gia)] if gia else []
    for s in candidati:
        if n >= quante:
            break
        b = s.get("blocco")
        if b and b in visti:
            continue
        u = sorted(membri.get(b, [s]), key=lambda x: x["orario"]) if b else [s]
        # Le obbligatorie entrano sempre (già senza ripetizioni); le altre non devono somigliare a nessuna già presa.
        confronto = fisse + [v for v in prese if v[0].get("sequenza")] if s.get("_obbligatoria") else prese + fisse
        if any(simili_larghi(x, y, d) for x in u for v in confronto for y in v):
            continue
        prese.append(u)
        n += len(u)
        if b:
            visti.add(b)
    return prese


def recupera_varianti(profilo, schede, alternative):
    """Foto di coppia: le varianti di un quasi doppione tornano disponibili se mostrano un gesto o un'espressione
    diversa (bacio invece di abbraccio, risata…). Nel piano saranno ritagliate più strette o in bianco e nero."""
    vc = profilo.get("valorizzaCoppia")
    if not vc:
        return []
    per_nome = {s["nome"]: s for s in schede}
    recuperate = []
    for nome, alt in alternative.items():
        orig = per_nome[nome]
        if capitolo_di(orig) not in vc["capitoli"]:
            continue
        viste = azioni(orig["espressione"])
        for n in sorted(alt, key=lambda n: -per_nome[n]["forza"]):
            s = per_nome[n]
            nuove = azioni(s["espressione"]) - viste
            if not nuove or s["forza"] < 3 or s.get("orientamentoDaCorreggere"):
                continue
            if orig.get("sequenza"):
                break
            s["variante"] = nome
            s["gestoNuovo"] = sorted(nuove)
            s["blocco"] = orig["blocco"] = f"var-{nome}"
            viste |= nuove
            recuperate.append(s)
            if sum(1 for x in recuperate if x["variante"] == nome) >= vc["variantiPerGruppo"]:
                break
    for s in recuperate:
        alternative[s["variante"]].remove(s["nome"])
    genera.recuperate = [(s["nome"], s["variante"], s["gestoNuovo"]) for s in recuperate]
    return recuperate


def tratta_varianti(profilo, out):
    """Ritaglio delle varianti: stretto se l'originale è nella stessa doppia (campo largo + primo piano),
    altrimenti lieve; fino al massimo del profilo, la pagina della variante lontana dall'originale va in bianco e nero."""
    vc = profilo.get("valorizzaCoppia")
    if not vc:
        return
    max_bn = profilo["biancoENero"]["areePerAlbum"]["max"]
    doppia_di = {it["fileName"]: sp["numero"] for sp in out for a in sp["areas"] for it in a["items"]}
    bn, ultimo = sum(1 for sp in out for a in sp["areas"] if a["style"].get("mono")), -10
    per_nome_var = getattr(tratta_varianti, "schede", {})
    for sp in out:
        for a in sp["areas"]:
            for it in a["items"]:
                orig = it.pop("_variante", None)
                if not orig:
                    continue
                vicina = doppia_di.get(orig) == sp["numero"]
                if not vicina and bn < max_bn and sp["numero"] - ultimo >= 4 and not a["style"].get("mono") and len(a["items"]) >= 2:
                    a["style"]["mono"] = True
                    a["trattamento"] = "bianco e nero"
                    bn += 1
                    ultimo = sp["numero"]
                    it["trattamento"] = f"variante di {orig} in bianco e nero"
                    continue
                if a["style"].get("mono"):
                    it["trattamento"] = f"variante di {orig} in bianco e nero"
                    continue
                if per_nome_var.get(it["fileName"], {}).get("tipo") in ("figura intera", "gruppo", "ambiente"):
                    it["trattamento"] = f"variante di {orig}, accanto all'originale senza ritaglio (figura intera)"
                    continue
                it["zoom"] = vc["ritaglioStretto"] if vicina else vc["ritaglioLieve"]
                it["cy"] = 0.42
                it["trattamento"] = f"variante di {orig}, ritaglio {'stretto' if vicina else 'lieve'} ({it['zoom']}×)"


def genera(profilo, schede):
    global INIZIO_CHIESA
    cer = [s["orario"][11:16] for s in schede if s["momento"] == "cerimonia" and s["orario"][11:13] >= "06"]
    if cer:
        INIZIO_CHIESA = min(cer)
    W, H = profilo["formato"]["widthCm"], profilo["formato"]["heightCm"]
    T_PAG, T_DOPPIA = W / H, 2 * W / H
    regole = profilo["regoleFisse"]
    ritmo = profilo["ritmo"]["sequenzaFotoPerDoppia"]
    quota_full = (regole["quotaFogliInteri"]["min"] + regole["quotaFogliInteri"]["max"]) / 2
    global VARIETA
    VARIETA = Varieta(profilo)

    pool = [s for s in schede if s["forza"] >= 3 and not s["orientamentoDaCorreggere"] and "doppione" not in s["note"]]
    escluse = len(schede) - len(pool)

    # Quasi doppioni (simili.py): una sola foto per gruppo, la più forte; le altre restano alternative.
    simili_path = DATI / "simili.json"
    alternative = {}
    if simili_path.exists():
        nel_pool = {s["nome"]: s for s in pool}
        for g in json.loads(simili_path.read_text(encoding="utf-8"))["gruppi"]:
            presenti = [nel_pool[n] for n in g if n in nel_pool]
            if len(presenti) < 2:
                continue
            migliore = max(presenti, key=lambda s: (s["punti"], s["forza"], -abs(len(presenti) // 2 - presenti.index(s))))
            alternative[migliore["nome"]] = [s["nome"] for s in presenti if s is not migliore]
        tolte = {n for v in alternative.values() for n in v}
        pool = [s for s in pool if s["nome"] not in tolte]
    genera.alternative = alternative
    sequenze = scegli_sequenze(profilo, [s for s in schede if s not in pool or True],
                               json.loads(simili_path.read_text(encoding="utf-8"))["gruppi"] if simili_path.exists() else [])
    for membri in sequenze:
        for s in membri:
            if s not in pool:
                pool.append(s)
            for v in alternative.values():
                if s["nome"] in v:
                    v.remove(s["nome"])
    genera.sequenze = [[s["nome"] for s in m] for m in sequenze]
    pool += recupera_varianti(profilo, schede, alternative)

    # Priorità del racconto (ricette.py): famiglia della sposa, bouquet della suocera, foto spontanee.
    for s in schede:
        s["punti"] = s["forza"] + (0.5 if s["paginaPiena"] else 0) - (0.5 if "variante" in s["note"] else 0) \
            + ricette.priorita(s, capitolo_di(s)) - (0.7 if s.get("ruolo") == "invitati" and capitolo_di(s) != "chiesa" else 0) \
            + (0.6 if s.get("ruolo") in ("ballo", "festa") else 0)

    # Apertura: a destra la foto orizzontale più forte degli esterni (la torta resta per il finale).
    finale = [s for s in pool if capitolo_di(s) == "esterni" and s["o"] == "o" and s["paginaPiena"]] or \
        [s for s in pool if capitolo_di(s) in ("esterni", "ristorante") and s["o"] == "o"]
    apertura = max(finale, key=lambda s: (s["punti"], s["orario"]))
    pool.remove(apertura)

    capitoli = [c for c in profilo["capitoli"] if c["id"] != "apertura"]
    doppie_capitoli = profilo["dimensioni"]["doppie"]["obiettivo"] - 1
    doppie_massime = profilo["dimensioni"]["doppie"]["max"] - 1
    spreads = [{"capitolo": "Apertura", "split": "half", "pagine": [[], [apertura]], "apertura": True}]
    passo = 0
    stat = {"full": 0, "totale": 0}

    def componi(unita, capitolo, **extra):
        """Doppia da unità (foto singole o blocchi): i blocchi non si dividono tra le pagine;
        una sequenza occupa da sola una pagina."""
        VARIETA.nuova_doppia()
        gruppo = [s for u in unita for s in u]
        seq = [u for u in unita if u[0].get("sequenza")]
        if seq:
            resto = [s for u in unita if u is not seq[0] for s in u]
            if not resto:
                return None
            pagine = [seq[0], resto] if seq[0][0]["orario"] <= resto[0]["orario"] else [resto, seq[0]]
            nodi = [miglior_area(pg, T_PAG)[1] for pg in pagine]
            for nodo in nodi:
                VARIETA.usa(nodo)
            stat["totale"] += 1
            return {"capitolo": capitolo, "split": "half", "pagine": pagine, "colonne": nodi, "cercaNovita": VARIETA.novita,
                    "tempo": min(s["orario"] for s in gruppo), **extra}
        tagli = set(itertools.accumulate(len(u) for u in unita[:-1]))
        opzioni = []
        if 2 <= len(gruppo) <= 12:
            c, col = miglior_area(gruppo, T_DOPPIA, piega=True)
            if col:
                opzioni.append((c, "full", [gruppo], [col]))
        for cut in sorted(tagli):
            sx, dx = gruppo[:cut], gruppo[cut:]
            if any(len(p) == 1 and p[0]["o"] == "v" for p in (sx, dx)) or max(len(sx), len(dx)) > 12:
                continue
            c1, col1 = miglior_area(sx, T_PAG)
            c2, col2 = miglior_area(dx, T_PAG)
            if col1 and col2:
                bonus = -0.25 if any(len(p) == 1 and p[0]["eroe"] for p in (sx, dx)) else 0
                sbilancio = 0.12 * abs(len(sx) - len(dx))
                opzioni.append((c1 + c2 + bonus + sbilancio, "half", [sx, dx], [col1, col2]))
        if not opzioni:
            return None
        full = [o for o in opzioni if o[1] == "full"]
        half = [o for o in opzioni if o[1] == "half"]
        vuole_full = len(gruppo) >= 7 or (stat["full"] / max(1, stat["totale"]) < quota_full)
        scelta = min(full, key=lambda o: o[0]) if full and (not half or (vuole_full and min(full)[0] <= min(half)[0] + 0.2)) else min(half, key=lambda o: o[0])
        for nodo in scelta[3]:
            VARIETA.usa(nodo)
        stat["totale"] += 1
        stat["full"] += scelta[1] == "full"
        return {"capitolo": capitolo, "split": scelta[1], "pagine": scelta[2], "colonne": scelta[3],
                "cercaNovita": VARIETA.novita, "tempo": min(s["orario"] for s in gruppo), **extra}

    # Ricette di sequenza (ricette.py) su tutte le foto utilizzabili del capitolo, anche quelle da 2 stelle
    # (i gruppi in posa lo sono quasi sempre); le loro foto non tornano nelle doppie libere.
    tolte_simili = {n for v in alternative.values() for n in v}
    # Le varianti dei quasi doppioni restano disponibili solo se sono momenti obbligatori (sposi con parenti e testimoni):
    # una variante con i genitori della sposa non è un doppione di quella con i genitori dello sposo.
    for s in schede:
        s["_alt"] = s["nome"] in tolte_simili
    utili = [s for s in schede if s["forza"] >= 2 and not s["orientamentoDaCorreggere"] and "doppione" not in s["note"]
             and (not s["_alt"] or ricette.obbligatoria(s)) and s is not apertura and not s.get("blocco")]
    tutte, specs_cap, fuori_cap = {}, {}, {}
    genera.obbligatorie = {}
    for c in capitoli:
        specs, usate_r, escluse_r = ricette.per_capitolo(c["id"], [s for s in utili if capitolo_di(s) == c["id"]])
        specs_cap[c["id"]] = specs
        fuori = usate_r | escluse_r
        fuori_cap[c["id"]] = fuori
        tutte[c["id"]] = sorted((s for s in pool if capitolo_di(s) == c["id"] and s["nome"] not in fuori), key=lambda s: -s["punti"])
    genera.ricette = {k: [s["ricetta"] for s in v] for k, v in specs_cap.items()}
    vc = profilo.get("valorizzaCoppia", {})
    fattori = {c["id"]: c.get("fattoreScene") for c in capitoli}
    per_cap = {k: limita_scene(v, profilo, fattori.get(k) or (vc.get("fattoreScene", 1) if k in vc.get("capitoli", []) else 1))
               for k, v in tutte.items()}
    assegnate = ripartisci(capitoli, per_cap, doppie_capitoli, doppie_massime, sum(ritmo) / len(ritmo),
                           {k: len(v) for k, v in specs_cap.items()})
    genera.ripartizione = assegnate
    genera.allentate = {}
    for cap in capitoli:
        n_doppie = max(0, assegnate[cap["id"]] - len(specs_cap[cap["id"]]))
        minimo = max(0, cap["doppie"]["min"] - len(specs_cap[cap["id"]]))
        candidati = per_cap[cap["id"]]
        # Capitolo con poche foto diverse: prima doppie più leggere (media 3), poi un limite per scena più largo.
        for fattore in (1.25, 1.5, 2, 3):
            if len(candidati) >= 3 * n_doppie:
                break
            candidati = limita_scene(tutte[cap["id"]], profilo, fattore)
            genera.allentate[cap["id"]] = fattore
        while True:
            base = [cap["fotoPerDoppia"]] * n_doppie if cap.get("fotoPerDoppia") else [ritmo[(passo + i) % len(ritmo)] for i in range(n_doppie)]
            dimensioni = adatta_ritmo(base, len(candidati))
            if sum(dimensioni) <= len(candidati) or n_doppie <= minimo:
                break
            n_doppie -= 1
        passo += n_doppie
        nelle_ricette = [s for spec in specs_cap[cap["id"]] for s in spec.get("gruppo", []) + [x for pg in spec.get("pagine", []) for x in pg]]
        # Sposi con famiglie e testimoni: obbligatorie, prima di tutte le altre (fuori dal limite per scena).
        obblig = ricette.senza_ripetizioni([s for s in utili if capitolo_di(s) == cap["id"] and ricette.obbligatoria(s)
                                            and s["nome"] not in fuori_cap[cap["id"]]])
        genera.obbligatorie[cap["id"]] = [s["nome"] for s in obblig]
        obblig.sort(key=lambda s: -s["punti"])
        for s in obblig:
            s["_obbligatoria"] = True
        # Le sequenze scelte vengono prima di tutto (sono poche e decise apposta), poi le obbligatorie.
        teste_seq = [max(g, key=lambda s: s["punti"]) for g in sequenze if capitolo_di(g[0]) == cap["id"]]
        # Le altre foto con i parenti ripetono quelle già scelte: restano fuori (salvo nelle sequenze).
        candidati = teste_seq + obblig + [s for s in candidati if s not in obblig and s not in teste_seq
                                          and (not ricette.obbligatoria(s) or s.get("sequenza"))]
        prese = seleziona(candidati, sum(dimensioni), tutte[cap["id"]], profilo["diversita"], nelle_ricette)
        coda = sorted(prese, key=lambda u: u[0]["orario"])
        # I fogli fissi (ricette) si inseriscono al loro momento: i fogli liberi si interrompono lì.
        tempi_fissi = [spec["tempo"] for spec in specs_cap[cap["id"]] if not spec.get("ultima")]
        del_capitolo = []
        for i_k, k in enumerate(dimensioni):
            if not coda:
                break
            if i_k == len(dimensioni) - 1 and k != 2:
                # L'ultima doppia del capitolo raccoglie le foto rimaste (fino a 12): nessuna scelta va persa.
                k = min(12, max(k, sum(len(u) for u in coda)))
            if k == 2:
                # Doppia leggera: le prossime due foto in ordine di scatto, se sono orizzontali (niente salti avanti).
                testa = [u[0] for u in coda[:2] if len(u) == 1]
                orizz = testa if len(testa) == 2 and all(s["o"] == "o" for s in testa) else []
                if len(orizz) == 2:
                    orizz.sort(key=lambda s: s["orario"])
                    coda = [u for u in coda if u[0] not in orizz]
                    del_capitolo.append({"capitolo": cap["titolo"], "split": "half", "pagine": [[orizz[0]], [orizz[1]]],
                                         "tempo": orizz[0]["orario"]})
                    stat["totale"] += 1
                    continue
                k = 3
            if k > 2 and i_k < len(dimensioni) - 1:
                # Il numero di doppie resta quello deciso: le foto rimaste si ridistribuiscono sulle doppie rimaste.
                k = max(3, round(sum(len(u) for u in coda) / (len(dimensioni) - i_k)))
            gruppo, n = [], 0
            while coda and (not gruppo or (n < k and n + len(coda[0]) <= k + 1)):
                n += len(coda[0])
                gruppo.append(coda.pop(0))
            # Una situazione non si spezza su due doppie: il taglio va nella pausa più lunga tra k-2 e k+2 foto.
            coda = gruppo + coda
            tot, opzioni_taglio = 0, []
            for m in range(1, len(coda) + 1):
                tot += len(coda[m - 1])
                if tot > min(12, k + 1):
                    break
                cambia = m < len(coda) and (relazione(coda[m - 1][-1]) != relazione(coda[m][0])
                                            or bool(coda[m - 1][-1].get("biancoNero")) != bool(coda[m][0].get("biancoNero"))
                                            or any(coda[m - 1][-1]["orario"] < tf <= coda[m][0]["orario"] for tf in tempi_fissi))
                # Cambio di persona (mamma, papà…) o di colore: si taglia lì anche se il foglio resta più leggero.
                if tot >= max(2, k - 2) or (cambia and tot >= 2):
                    pausa_s = (ts(coda[m][0]) - ts(coda[m - 1][-1])).total_seconds() if m < len(coda) else 1e9
                    if k <= 3:
                        # Capitolo a foto grandi (esterne): conta il numero di foto per foglio, poi la pausa.
                        opzioni_taglio.append((cambia, -abs(tot - k), pausa_s >= 120, pausa_s, m))
                    else:
                        opzioni_taglio.append((cambia, pausa_s >= 120, pausa_s, -abs(tot - k), m))
            m = max(opzioni_taglio)[-1] if opzioni_taglio else len(gruppo)
            gruppo, coda = coda[:m], coda[m:]
            if len(gruppo) == 1 and gruppo[0][0].get("sequenza") and coda:
                gruppo.append(coda.pop(0))
            bn_u = [u for u in gruppo if any(s.get("biancoNero") for s in u)]
            if bn_u and 2 * len(bn_u) < len(gruppo):
                # Poche foto in bianco e nero tra foto a colori: restano fuori, salvo i momenti con i parenti
                # (allora tutto il foglio va in bianco e nero).
                gruppo = [u for u in gruppo if u not in bn_u or any(s.get("_obbligatoria") for s in u)]
            sp = componi(gruppo, cap["titolo"])
            # Foglio che si riempie solo tagliando mani e piedi (o lasciando bande bianche): prende la foto successiva.
            for _ in range(2):
                if sp is None or not coda or sum(len(u) for u in gruppo) >= 8 or cap.get("fotoPerDoppia", 5) <= 3:
                    break  # nelle esterne poche foto grandi: meglio una banda bianca che un foglio affollato
                tgt = T_DOPPIA if sp["split"] == "full" else T_PAG
                if not any(taglia_troppo(c, tgt) for c in sp["colonne"]):
                    break
                ultimo, prossimo = gruppo[-1][-1], coda[0][0]
                if relazione(ultimo) != relazione(prossimo) or bool(ultimo.get("biancoNero")) != bool(prossimo.get("biancoNero")):
                    break  # meglio un po' di bianco che mescolare persone o colore e bianco e nero
                gruppo.append(coda.pop(0))
                sp = componi(gruppo, cap["titolo"])
            if sp is None:
                # Gruppo impossibile (es. una sola verticale): lo unisce al successivo.
                if not coda:
                    break
                coda = gruppo + coda
                coda[:2] = [coda[0] + coda[1]] if len(coda) > 1 and not any(s.get("sequenza") for s in coda[0] + coda[1]) else coda[:2]
                continue
            del_capitolo.append(sp)
        for spec in specs_cap[cap["id"]]:
            if "pagine" in spec:
                nodi = [miglior_area(pg, T_PAG)[1] for pg in spec["pagine"]]
                for nodo in nodi:
                    VARIETA.usa(nodo)
                stat["totale"] += 1
                del_capitolo.append({"capitolo": cap["titolo"], "split": "half", "pagine": spec["pagine"], "colonne": nodi,
                                     "tempo": spec["tempo"], "ricetta": spec["ricetta"],
                                     "prima": spec.get("prima", False), "ultima": spec.get("ultima", False)})
            else:
                sp = componi([[s] for s in spec["gruppo"]], cap["titolo"], ricetta=spec["ricetta"], ultima=spec.get("ultima", False))
                if sp:
                    sp["tempo"] = spec["tempo"]
                    del_capitolo.append(sp)
        del_capitolo.sort(key=lambda s: (s.get("ultima", False), not s.get("prima", False), s["tempo"], not s.get("ricetta")))
        spreads += del_capitolo
    return spreads, apertura, escluse, T_PAG, T_DOPPIA


def stile_aree(spreads, profilo):
    """Pagine di pausa: una per capitolo, su pagine di soli dettagli (o 1-2 foto intime), mai due di fila."""
    massimo = profilo["paginaDiPausa"]["perAlbum"]["max"]
    pause, ultimo, visti = 0, -5, set()
    for sp in spreads:
        sp["pausa"] = [False] * len(sp["pagine"])
    # La pagina dei dettagli della chiesa (ricetta) è la pausa naturale del capitolo.
    fisse = [i for i, sp in enumerate(spreads) if sp.get("ricetta", "").startswith("dettagli della chiesa")]
    fisse = fisse[:massimo]
    for i in fisse:
        spreads[i]["pausa"][0] = True
        visti.add(spreads[i]["capitolo"])
        pause += 1
    for i, sp in enumerate(spreads):
        vicino_fisso = any(abs(i - f) < 3 for f in fisse)
        if sp.get("apertura") or sp["split"] != "half" or sp["capitolo"] in visti or i - ultimo < 3 or pause >= massimo or vicino_fisso:
            continue
        for j, pagina in enumerate(sp["pagine"]):
            if any(s.get("sequenza") for s in pagina):
                continue
            dett = sum(s["tipo"] == "dettaglio" for s in pagina)
            if 1 <= len(pagina) <= 4 and (dett == len(pagina) or (len(pagina) <= 3 and dett >= 1)):
                sp["pausa"][j] = True
                pause += 1
                ultimo = i
                visti.add(sp["capitolo"])
                break
    return pause


FRASI_PATH = DATI / "frasi.json"
FRASI = json.loads(FRASI_PATH.read_text(encoding="utf-8")) if FRASI_PATH.exists() else {"apertura": {}, "capitoli": {}}


def testo(id_, text, x, y, w, font, size, color, uppercase=False, italic=False, tracking=0.04, stile_nome=""):
    """Overlay di testo nel formato dei progetti Album Flow (coordinate relative alla doppia)."""
    return {"kind": "text", "id": id_, "text": text, "x": x, "y": y, "w": w, "rotation": 0, "z": 1, "font": font,
            "sizePt": size, "weight": 400, "italic": italic, "color": color, "align": "center", "lineHeight": 1.3,
            "trackingEm": tracking, "uppercase": uppercase, "paragraphSpacePt": 0, "dropCapLines": 0, "opacity": 1,
            "styleName": stile_nome}


def testi_doppia(sp, aree):
    """Apertura: nomi e data stilizzata sulla pagina sinistra (il logo lo inserisce Gennaro).
    Frasi: una per capitolo, sotto la pagina di pausa (fondo bianco con margine), al più una per doppia."""
    if sp.get("apertura"):
        a = FRASI["apertura"]
        return [testo("tx-nomi", a.get("nomi", ""), 0.05, 0.47, 0.4, "bodoni-moda", 48, "#f1ebe0", True, stile_nome="Nomi"),
                testo("tx-data", a.get("data", ""), 0.05, 0.56, 0.4, "jost", 14, "#cdbf9f", True, tracking=0.32, stile_nome="Data")]
    frasi = FRASI["capitoli"].get(capitolo_id(sp["capitolo"]), [])
    usate = testi_doppia.usate
    if not frasi or sp["capitolo"] in usate:
        return []
    for j, a in enumerate(aree):
        if a.get("pausa"):
            usate.add(sp["capitolo"])
            x = 0.5 * j if sp["split"] != "full" else 0
            return [testo("tx-frase", frasi[0], x + 0.06, 0.935, 0.38, "cormorant", 13, "#555555", italic=True,
                          tracking=0.02, stile_nome="Frase")]
    return []


testi_doppia.usate = set()


def capitolo_id(titolo):
    return {"Casa sposo": "casa-sposo", "Casa sposa": "casa-sposa", "Chiesa": "chiesa", "Esterni": "esterni",
            "Ristorante": "ristorante"}.get(titolo, "")


def costruisci_piano(profilo, spreads, foto, T_PAG, T_DOPPIA):
    stile = profilo["stilePredefinito"]
    pausa = profilo["paginaDiPausa"]["stile"]
    contatore = itertools.count(1)
    assets, out, usate = {}, [], []
    for sp in spreads:
        dividi_se_taglia(sp, T_PAG, T_DOPPIA)
    for n, sp in enumerate(spreads, 1):
        aree = []
        for j, pagina in enumerate(sp["pagine"]):
            items, ids = [], {}
            for s in pagina:
                iid = f"item-{next(contatore):04d}"
                ids[s["nome"]] = iid
                items.append({"id": iid, "assetId": f"asset-{s['nome']}", "fileName": s["nome"], "zoom": 1, "cx": {"sx": 0.35, "dx": 0.65}.get(s.get("soggetto"), 0.5), "cy": 0.5,
                              **({"_variante": s["variante"]} if s.get("variante") else {})})
                usate.append(s["nome"])
                f = foto[s["nome"]]
                assets[s["nome"]] = {"id": f"asset-{s['nome']}", "fileName": s["nome"], "path": f["percorso"], "absolutePath": f["percorso"],
                                     "width": f["larghezza"], "height": f["altezza"], "aspectRatio": round(s["aspect"], 4),
                                     "orientation": "vertical" if s["o"] == "v" else "horizontal", "captureTimeLocal": s["orario"],
                                     "camera": f"{s['macchina']} ({s['seriale']})", "forza": s["forza"], "momento": s["momento"],
                                     "alternative": getattr(genera, "alternative", {}).get(s["nome"], [])}
            if not pagina:
                aree.append({"target": "page", "layout": None, "items": [],
                             "style": {**stile, "background": "#000000"}, "apertura": {"logo": "da inserire", **FRASI["apertura"]}})
                continue
            target = "full" if sp["split"] == "full" else "page"
            colonne = sp["colonne"][j] if "colonne" in sp else miglior_area(pagina, T_PAG)[1]
            layout = albero(colonne, lambda s: ids[s["nome"]])
            area_stile = pausa if sp.get("pausa", [False, False])[j] else stile
            origine = colonne.get("origine")
            sequenza = all(s.get("sequenza") for s in pagina)
            t_area = T_DOPPIA if target == "full" else T_PAG
            proporzioni = taglia_troppo(colonne, t_area)
            if proporzioni and not sp.get("pausa", [False, False])[j]:
                # Nessun ritaglio accettabile: foto intere su fondo bianco con margine (come le tue pagine di pausa),
                # nella disposizione che lascia meno bianco.
                colonne = miglior_fit(pagina, t_area)
                layout = albero(colonne, lambda s: ids[s["nome"]])
                area_stile = {**area_stile, "mode": "fit", "paddingCm": 0, "gapCm": 0.1}
            aree.append({"target": target, "templateId": forma(layout), "composizione": origine, "layout": layout, "items": items,
                         "style": {**area_stile, **({"mono": True} if sequenza else {})}, "pausa": area_stile is pausa,
                         **({"sequenza": "raffica in bianco e nero"} if sequenza else {})})
        motivo = motivazione(sp)
        out.append({"numero": n, "momento": sp["capitolo"], "split": sp["split"], "areas": aree, "motivazione": motivo,
                    "overlays": testi_doppia(sp, aree)})
    tratta_varianti.schede = {s["nome"]: s for sp in spreads for pg in sp["pagine"] for s in pg}
    tratta_varianti(profilo, out)
    per_nome = tratta_varianti.schede
    for sp in out:
        aree = [a for a in sp["areas"] if a["items"]]
        bn = any(a["style"].get("mono") for a in aree) or any(per_nome[it["fileName"]].get("biancoNero") for a in aree for it in a["items"])
        if bn:
            for a in aree:
                if not a["style"].get("mono"):
                    a["style"]["mono"] = True
                    a["trattamento"] = "bianco e nero (foglio uniforme)"
    for sp in out:
        tratt = [it["trattamento"] for a in sp["areas"] for it in a["items"] if it.get("trattamento")]
        if tratt:
            sp["motivazione"] += " Foto di coppia valorizzate: " + "; ".join(tratt) + "."
    return out, assets, usate


def dividi_se_taglia(sp, T_PAG, T_DOPPIA):
    """Un foglio intero che si riempie solo tagliando troppo non diventa «foto intere con margine»: col margine
    il blocco si centra e la foto di mezzo finisce sulla piega. Si divide invece in due pagine, nel punto
    che taglia meno."""
    if sp["split"] != "full" or sp.get("apertura") or not sp["pagine"] or len(sp["pagine"][0]) < 2:
        return
    foto = sp["pagine"][0]
    col = sp["colonne"][0] if "colonne" in sp else miglior_area(foto, T_DOPPIA, piega=True)[1]
    if not taglia_troppo(col, T_DOPPIA):
        return
    migliore = None
    for k in range(1, len(foto)):
        sx, dx = foto[:k], foto[k:]
        if any(len(pg) == 1 and pg[0]["o"] == "v" for pg in (sx, dx)):
            continue  # una verticale da sola su una pagina 40x30 resterebbe tra due bande bianche
        nodi = [miglior_area(pg, T_PAG)[1] for pg in (sx, dx)]
        peggio = (sum(taglia_troppo(n, T_PAG) for n in nodi), max(taglio_massimo(n, T_PAG) for n in nodi))
        if migliore is None or peggio < migliore[0]:
            migliore = (peggio, [sx, dx], nodi)
    if migliore is None:
        return
    sp["split"], sp["pagine"], sp["colonne"] = "half", migliore[1], migliore[2]
    sp["pausa"] = [False, False]


def motivazione(sp):
    if sp.get("apertura"):
        s = sp["pagine"][1][0]
        return f"Apertura come nei tuoi album: pagina nera con i nomi e, fuori sequenza, {s['espressione']} ({s['nome']})."
    foto = [s for p in sp["pagine"] for s in p]
    forte = max(foto, key=lambda s: s["punti"])
    tipi = sorted({s["tipo"] for s in foto})
    if sp["split"] == "full":
        base = f"Foglio intero con {len(foto)} foto in colonne ({', '.join(tipi)})"
    elif all(len(p) == 1 for p in sp["pagine"]):
        base = "Doppia leggera: una orizzontale forte per pagina"
    else:
        base = f"Due pagine, {len(sp['pagine'][0])} + {len(sp['pagine'][1])} foto"
    extra = "; pagina di pausa su fondo bianco" if any(sp.get("pausa", [])) else ""
    nomi = {"tuo": "tua composizione {id} (usata {usi} volte in {album} album)", "specchio": "tua composizione {id} a specchio",
            "nuovo": "composizione nuova"}
    origini = [n.get("origine") for n in sp.get("colonne", [])]
    descr = [nomi[o["tipo"]].format(**o) for o in origini if o]
    if descr:
        extra += ". " + ("; ".join(descr)).capitalize()
    if sp.get("cercaNovita"):
        extra += " (doppia che cerca una soluzione nuova)"
    return f"{base}{extra}. Foto guida: {forte['espressione']} ({forte['nome']}, {forte['forza']}★)."


# ---------------------------------------------------------------------------
# Controlli del profilo
# ---------------------------------------------------------------------------

def controlla(profilo, piano, n_selezione):
    regole, dim = profilo["regoleFisse"], profilo["dimensioni"]
    sp = piano["spreads"]
    violazioni, esito = [], {}
    n = len(sp)
    foto_doppia = [sum(len(a["items"]) for a in s["areas"]) for s in sp]
    full = [s for s in sp if s["split"] == "full"]
    if any(sum(len(a["items"]) for a in s["areas"]) == 1 for s in full):
        violazioni.append("foglio intero con una foto sola")
    # Album Flow: al massimo 12 foto per area (MAX_AREA_PHOTOS in apps/album-flow/src/engine/generate.ts).
    origini = [a.get("composizione") for s in sp for a in s["areas"] if a.get("composizione")]
    for tipo in ("tuo", "specchio", "nuovo"):
        esito["aree:" + tipo] = sum(1 for o in origini if o["tipo"] == tipo)
    chiavi = [o["chiave"] for o in origini]
    esito["composizioniDiverse"] = len(set(chiavi))
    per_scena = {}
    for s in sp:
        for a in s["areas"]:
            for it in a["items"]:
                sc = piano["_scena"].get(it["fileName"])
                if sc:
                    per_scena.setdefault(sc[0], [0, sc[1]])[0] += 1
    oltre = [k for k, (n, tetto) in per_scena.items() if n > tetto]
    esito["fotoMaxPerScena"] = max((n for n, _ in per_scena.values()), default=0)
    if oltre:
        violazioni.append(f"scene oltre il limite: {oltre}")
    for c in profilo["capitoli"]:
        if "min" not in (c.get("doppie") or {}) if isinstance(c.get("doppie"), dict) else True:
            continue
        k = sum(1 for s in sp if s["momento"] == c["titolo"])
        esito["doppie:" + c["id"]] = k
        if not c["doppie"]["min"] <= k <= c["doppie"]["max"] + 1:
            violazioni.append(f"{c['titolo']}: {k} doppie fuori da {c['doppie']['min']}-{c['doppie']['max']}")
    pagine = [(s["numero"], k, it["fileName"]) for s in sp for k, a in enumerate(s["areas"]) for it in a["items"]]
    schede_p = piano["_s"]
    sparse = []
    for i, (d1, a1, n1) in enumerate(pagine):
        for d2, a2, n2 in pagine[i + 1:]:
            if d1 == d2:
                continue
            x, y = schede_p[n1], schede_p[n2]
            if x.get("blocco") and x.get("blocco") == y.get("blocco"):
                continue
            if ricette.obbligatoria(x) and ricette.obbligatoria(y):
                continue
            if simili_larghi(x, y, profilo["diversita"]):
                sparse.append(f"{n1} (d{d1}) / {n2} (d{d2})")
    esito["fotoSimiliSuFogliDiversi"] = len(sparse)
    if sparse:
        violazioni.append("foto simili su fogli diversi: " + "; ".join(sparse[:6]))
    esito["sequenze"] = sum(1 for s in sp for a in s["areas"] if a.get("sequenza"))
    esito["areeBN"] = sum(1 for s in sp for a in s["areas"] if a["style"].get("mono"))
    esito["variantiRitagliate"] = sum(1 for s in sp for a in s["areas"] for it in a["items"] if it.get("zoom", 1) > 1)
    # Il limite vale per il bianco e nero deciso dal motore; i fogli con foto già consegnate in B/N non contano.
    bn_motore = sum(1 for s in sp for a in s["areas"] if a["style"].get("mono")
                    and not any(schede_p[it["fileName"]].get("biancoNero") for x in s["areas"] for it in x["items"]))
    if bn_motore > profilo["biancoENero"]["areePerAlbum"]["max"]:
        violazioni.append(f"{bn_motore} aree in bianco e nero decise dal motore (massimo {profilo['biancoENero']['areePerAlbum']['max']})")
    massimo_area = regole["fotoPerFoglioIntero"]["max"]
    troppe = [s["numero"] for s in sp for a in s["areas"] if len(a["items"]) > massimo_area]
    esito["fotoMaxPerArea"] = max(len(a["items"]) for s in sp for a in s["areas"])
    if troppe:
        violazioni.append(f"più di {massimo_area} foto in un'area: doppie {troppe}")
    q = len(full) / n
    esito["quotaFogliInteri"] = round(q, 2)
    if not regole["quotaFogliInteri"]["min"] <= q <= regole["quotaFogliInteri"]["max"]:
        violazioni.append(f"quota fogli interi {q:.0%} fuori da {regole['quotaFogliInteri']}")
    vert_sole = sum(1 for s in sp for a in s["areas"] if len(a["items"]) == 1 and piano["_o"][a["items"][0]["fileName"]] == "v")
    esito["verticaliDaSole"] = vert_sole
    if vert_sole > 2:
        violazioni.append(f"{vert_sole} verticali da sole in una pagina (massimo 2)")
    leggere = [i for i, k in enumerate(foto_doppia) if k <= 2 and i > 0]
    consecutive = [i + 1 for a, i in zip(leggere, leggere[1:]) if i == a + 1]
    if consecutive:
        violazioni.append(f"doppie leggere consecutive: {consecutive}")
    media = sum(foto_doppia) / n
    esito.update({"doppie": n, "foto": sum(foto_doppia), "fotoPerDoppia": round(media, 2),
                  "quotaSelezione": round(sum(foto_doppia) / n_selezione, 2),
                  "pagineDiPausa": sum(1 for s in sp for a in s["areas"] if a.get("pausa"))})
    if not dim["doppie"]["min"] <= n <= dim["doppie"]["max"]:
        violazioni.append(f"{n} doppie fuori da {dim['doppie']}")
    if not dim["fotoPerDoppiaMedia"]["min"] <= media <= dim["fotoPerDoppiaMedia"]["max"]:
        violazioni.append(f"media {media:.1f} foto per doppia fuori da {dim['fotoPerDoppiaMedia']}")
    return violazioni, esito


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profilo", default=str(QUI / "stile-gennaro.json"))
    ap.add_argument("--uscita", default=str(DATI / "piano-album-stile.json"))
    args = ap.parse_args()
    profilo, schede, foto = carica(args.profilo)
    spreads, apertura, escluse, T_PAG, T_DOPPIA = genera(profilo, schede)
    pause = stile_aree(spreads, profilo)
    out, assets, usate = costruisci_piano(profilo, spreads, foto, T_PAG, T_DOPPIA)
    assert len(usate) == len(set(usate)), "foto usata due volte"
    capitoli = []
    for c in dict.fromkeys(s["momento"] for s in out):
        nums = [s["numero"] for s in out if s["momento"] == c]
        capitoli.append({"title": c, "doppiePagine": [min(nums), max(nums)],
                         "foto": sum(len(a["items"]) for s in out if s["momento"] == c for a in s["areas"])})
    piano = {
        "formato": "filex-album-flow-piano", "versione": 1, "schemaAlbumFlow": 2,
        "generato": datetime.now().isoformat(timespec="seconds"), "profilo": profilo["nome"],
        "progetto": {"projectName": f"{FRASI.get('apertura', {}).get('nomi') or DATI.name} (piano con profilo)",
                     "sheet": {"widthCm": profilo["formato"]["widthCm"], "heightCm": profilo["formato"]["heightCm"]},
                     "defaultStyle": profilo["stilePredefinito"]},
        "album": {"numeroDoppiePagine": len(out), "numeroFoto": len(usate), "fotoNellaSelezione": len(schede), "racconto": capitoli},
        "chapters": capitoli, "assets": list(assets.values()), "spreads": out,
    }
    piano["_o"] = {s["nome"]: s["o"] for s in schede}
    piano["_s"] = {s["nome"]: s for s in schede}
    piano["_scena"] = {s["nome"]: (s["scena"], s["tettoScena"]) for s in schede if "scena" in s}
    violazioni, esito = controlla(profilo, piano, len(schede))
    del piano["_o"], piano["_scena"], piano["_s"]
    piano["controlli"] = {"esito": esito, "violazioni": violazioni}
    Path(args.uscita).write_text(json.dumps(piano, ensure_ascii=False, indent=2), encoding="utf-8")
    scrivi_md(piano, Path(args.uscita).with_suffix(".md"))
    print(f"Escluse in partenza (forza < 3, doppioni, orientamento da correggere): {escluse}")
    alt = getattr(genera, "alternative", {})
    print(f"Quasi doppioni: {len(alt)} gruppi, {sum(len(v) for v in alt.values())} foto tenute come alternative")
    print("Capitoli:", ", ".join(f"{c['title']} {c['doppiePagine'][0]}-{c['doppiePagine'][1]} ({c['foto']} foto)" for c in capitoli))
    print("Esito:", esito)
    print("Violazioni:", violazioni or "nessuna")
    return 0 if not violazioni else 1


def scrivi_md(piano, path):
    split = {"full": "foglio intero", "half": "due pagine"}
    r = [f"# {piano['progetto']['projectName']}", "", f"Profilo: {piano['profilo']}. {piano['album']['numeroDoppiePagine']} doppie, {piano['album']['numeroFoto']} foto.", "",
         "## Controlli del profilo", "", "```", json.dumps(piano["controlli"], ensure_ascii=False, indent=2), "```", "", "## Doppie pagine", ""]
    for sp in piano["spreads"]:
        r.append(f"### {sp['numero']}. {sp['momento']} — {split[sp['split']]}")
        lati = ["Foglio intero"] if sp["split"] == "full" else ["Sinistra", "Destra"]
        for lato, a in zip(lati, sp["areas"]):
            nomi = ", ".join(i["fileName"] for i in a["items"]) or a.get("testo", "").replace("\n", " · ")
            r.append(f"- {lato}{' (pausa)' if a.get('pausa') else ''} — `{a.get('templateId', 'testo')}`: {nomi}")
        r += [f"- Perché: {sp['motivazione']}", ""]
    path.write_text("\n".join(r), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
