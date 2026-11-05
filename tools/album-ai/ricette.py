"""Ricette di sequenza: i fogli che Gennaro costruisce quasi sempre allo stesso modo.

Ogni ricetta riconosce le foto dalle schede (momento, tipo, espressione, note, orario) e restituisce doppie già
decise nel contenuto; la disposizione la sceglie poi il motore con le composizioni dell'utente.
- Chiesa: pagina con i dettagli della chiesa a sinistra e il grandangolo dal fondo a destra (durante il rito);
  foglio delle firme con le foto di gruppo all'altare; foglio successivo con la sola uscita degli sposi
  (lancio, picchetto…) ed eventualmente il rinfresco.
- Casa sposo e casa sposa: i gruppetti in posa nello stesso angolo vanno raccolti negli stessi fogli.
- Ristorante: il finale è il taglio della torta.
Le parole chiave valgono finché le schede non hanno un campo «ruolo»: con le schede nuove basterà leggere quello.
"""
import re

PAROLE = {
    "firma": r"firm",
    "uscita": r"\besc[oe]|uscit|portone|sciabol|\blanci|\briso\b|petal|scalinat|picchett|sagrato|coriandol",
    "rinfresco": r"rinfresc|banchett|aperitiv|buffet|brindisi",
    "decoro": r"altare|ampoll|calice|fior|libretto|ventaglio|banc|addobb|candel|facciata|organo|vetrat|crocifiss|navata|chiesa",
    "persone": r"mani|fedi|spos|sacerdot|invitat|damigell|testimon|madre|padre|amic",
    "panoramica": r"intera|dal fondo|durante il rito|panoram|grandangol",
    "ingresso": r"entra|ingresso|damigell",
    "posa": r"in posa|stesso gruppo|foto di famiglia|famiglia in posa|foto di gruppo|sguardi in camera|in camera",
    "spontanea": r"rid|risat|abbracc|lancio|euforia|spontane|applaus|commoz|lacrim|bacio|carezz",
    "torta": r"torta",
    "suocera": r"suocer|consegna del bouquet|consegna il bouquet",
    "famiglia": r"\bmadre\b|\bmamma\b|\bpadre\b|\bpap[aà]\b|genitor",
    "parenti": r"genitor|\bmadre\b|\bpadre\b|\bmamma\b|\bpap[aà]\b|testimon|nonn|fratell|sorell|famigl|suocer|\bzi[oaie]\b|cugin|parent",
}


# Con le schede che hanno il campo «ruolo» le chiavi dei momenti fissi si leggono da lì, non dalle parole chiave.
RUOLI = {
    "firma": {"firme"}, "uscita": {"uscita-chiesa"}, "rinfresco": {"rinfresco"}, "decoro": {"dettaglio-chiesa"},
    "panoramica": {"chiesa-intera"}, "ingresso": {"ingresso"}, "posa": {"gruppo-posa"}, "torta": {"torta"},
    "suocera": {"bouquet-suocera"},
}
SENZA_PERSONE = {"dettaglio", "dettaglio-chiesa", "chiesa-intera"}


def con_sposi(s):
    """Gli sposi sono nella foto? «genitori dello sposo» da soli non bastano; brindisi e balli con i parenti sì."""
    t = s["espressione"].lower()
    if re.search(r"brindisi con|ball[ao] con|ball[ao] col", t):
        return True
    t = re.sub(r"\bde(?:l|lla|llo|gli|i)\s+spos[oai]\b", "", t)
    return re.search(r"\bspos[oai]\b", t) is not None


def obbligatoria(s):
    """Sposi con genitori, testimoni, fratelli, nonni…: momenti che non si tralasciano mai."""
    if s.get("ruolo"):
        return s["ruolo"] in ("con-parenti", "bouquet-suocera")
    return con_sposi(s) and ha(s, "parenti") and not s.get("orientamentoDaCorreggere")


def senza_ripetizioni(foto, per_scena=2):
    """Tra le obbligatorie: per ogni relazione (madre, padre, testimoni…) al più `per_scena` foto ogni 2 minuti, le più forti."""
    minuti = lambda s: int(s["orario"][11:13]) * 60 + int(s["orario"][14:16])
    tenute = []
    for s in sorted(foto, key=lambda s: -s["punti"]):
        testo = s["espressione"].lower()
        lato = ("sposa" if "della sposa" in testo else "") + ("sposo" if "dello sposo" in testo else "")
        chiave = tuple(sorted(set(re.findall(PAROLE["parenti"], testo)))) + (lato, testo.split()[0])
        # Le foto in posa dello stesso gruppo (anche da macchine diverse, a ore diverse) contano una volta sola.
        in_posa = "in posa" in s["espressione"].lower()
        stessi = [x for x in tenute if x["_rel"] == chiave
                  and (abs(minuti(x) - minuti(s)) <= 2 or (in_posa and "in posa" in x["espressione"].lower()))]
        if len(stessi) < (1 if in_posa else per_scena):
            s["_rel"] = chiave
            tenute.append(s)
    return sorted(tenute, key=lambda s: s["orario"])


def ha(s, chiave):
    r = s.get("ruolo")
    if r and chiave in RUOLI:
        return r in RUOLI[chiave]
    if r and chiave == "persone":
        return r not in SENZA_PERSONE
    return re.search(PAROLE[chiave], (s["espressione"] + " | " + s["note"]).lower()) is not None


def migliori(foto, n):
    """Le n più forti, in ordine di scatto; le varianti dei quasi doppioni restano fuori."""
    foto = [s for s in foto if not s.get("_alt")]
    return sorted(sorted(foto, key=lambda s: -s["punti"])[:n], key=lambda s: s["orario"])


def chiesa(foto):
    specs, usate, escluse = [], set(), set()
    ordinate = sorted(foto, key=lambda s: s["orario"])
    firme = [s for s in ordinate if ha(s, "firma")]
    # Il momento delle firme è il primo gruppo di almeno 3 firme in 5 minuti (una firma isolata non basta).
    minuti = lambda s: int(s["orario"][11:13]) * 60 + int(s["orario"][14:16])
    nucleo = [f for f in firme if sum(1 for g in firme if 0 <= minuti(g) - minuti(f) <= 5) >= 3]
    if nucleo:
        t0 = nucleo[0]["orario"]
        # L'uscita comincia con gli sposi (la seconda macchina fuori sul sagrato durante le firme non conta).
        uscita0 = next((s["orario"] for s in ordinate if s["orario"] > t0 and ha(s, "uscita") and not ha(s, "firma")
                        and ("spos" in s["espressione"].lower() or s.get("ruolo"))), None)
        altare = [s for s in ordinate if t0 <= s["orario"] < (uscita0 or "9")]
        # Foglio delle firme e dei gruppi all'altare: le firme, poi tutti i gruppi degli sposi con famiglie e testimoni.
        scelte = migliori([s for s in altare if ha(s, "firma") and s["forza"] >= 3], 3)
        scelte += [s for s in senza_ripetizioni([s for s in altare if obbligatoria(s)], 1) if s not in scelte]
        scelte += migliori([s for s in altare if s not in scelte and s["forza"] >= 3], max(0, 9 - len(scelte)))
        if len(scelte) >= 3:
            specs.append({"ricetta": "firme e gruppi all'altare", "tempo": t0, "gruppo": sorted(scelte, key=lambda s: s["orario"])})
        escluse |= {s["nome"] for s in altare}
        if uscita0:
            dopo = [s for s in ordinate if s["orario"] >= uscita0]
            rinfresco0 = next((s["orario"] for s in dopo if ha(s, "rinfresco")), "9")
            uscita = migliori([s for s in dopo if s["orario"] < rinfresco0 and s["forza"] >= 3], 7)
            rinfresco = migliori([s for s in dopo if s["orario"] >= rinfresco0 and s["forza"] >= 3], 8 - len(uscita) if len(uscita) >= 6 else 2)
            if uscita:
                specs.append({"ricetta": "uscita degli sposi" + (" e rinfresco" if rinfresco else ""), "tempo": uscita0,
                              "gruppo": sorted(uscita + rinfresco, key=lambda s: s["orario"])})
            escluse |= {s["nome"] for s in dopo}
        rito = [s for s in ordinate if s["orario"] < t0]
    else:
        rito = ordinate
    # Durante il rito: dettagli della chiesa a sinistra, grandangolo dal fondo a destra.
    pano = [s for s in rito if s["o"] == "o" and s["tipo"] == "ambiente" and ha(s, "panoramica") and not ha(s, "ingresso") and s["forza"] >= 3]
    decori = [s for s in rito if s["tipo"] in ("dettaglio", "ambiente") and ha(s, "decoro") and not ha(s, "persone") and s["forza"] >= 2]
    if pano and decori:
        p = max(pano, key=lambda s: s["punti"])
        d = migliori([s for s in decori if s is not p], 3)
        specs.append({"ricetta": "dettagli della chiesa e grandangolo dal fondo", "tempo": p["orario"], "pagine": [d, [p]]})
    for sp in specs:
        usate |= {s["nome"] for s in sp.get("gruppo", []) + [x for pg in sp.get("pagine", []) for x in pg]}
    return specs, usate, escluse


def casa(foto):
    """Gruppetti in posa (stesso angolo, tutti simili): raccolti in fogli dedicati, 6-10 foto per foglio."""
    posa = [s for s in foto if s["tipo"] == "gruppo" and ha(s, "posa") and not ha(s, "spontanea") and s["forza"] >= 2 and not s.get("_alt")]
    specs = []
    posa.sort(key=lambda s: s["orario"])
    if len(posa) >= 4:
        n_fogli = 1 if len(posa) <= 10 else 2
        per = -(-len(posa) // n_fogli)
        for i in range(n_fogli):
            g = posa[i * per:(i + 1) * per]
            specs.append({"ricetta": "gruppi in posa", "tempo": g[0]["orario"], "gruppo": g})
    return specs, {s["nome"] for sp in specs for s in sp["gruppo"]}, {s["nome"] for s in posa}


def ristorante(foto):
    """Finale: il taglio della torta chiude l'album; quello che viene dopo resta fuori."""
    torta = [s for s in foto if ha(s, "torta") and s["forza"] >= 3]
    if not torta:
        return [], set(), set()
    t0 = min(s["orario"] for s in torta)
    # Il momento della torta comprende i brindisi con genitori e testimoni: non si tralasciano.
    famiglie = senza_ripetizioni([s for s in foto if s["orario"] >= t0 and obbligatoria(s)], 1)
    scelte = migliori(torta, max(4, 10 - len(famiglie))) + [s for s in famiglie if s not in torta]
    scelte.sort(key=lambda s: s["orario"])
    dopo = {s["nome"] for s in foto if s["orario"] >= t0}
    return [{"ricetta": "finale sul taglio della torta", "tempo": t0, "gruppo": scelte, "ultima": True}], {s["nome"] for s in scelte}, dopo


def per_capitolo(cap_id, foto):
    if any(s.get("ruolo") for s in foto):
        import ricette_ruoli as rr
        if cap_id == "chiesa":
            return rr.chiesa(foto, obbligatoria, senza_ripetizioni)
        if cap_id in ("casa-sposo", "casa-sposa"):
            return rr.casa(foto, casa)
        if cap_id == "ristorante":
            return rr.ristorante(foto, obbligatoria, senza_ripetizioni)
        return rr.esterni(foto)
    if cap_id == "chiesa":
        return chiesa(foto)
    if cap_id in ("casa-sposo", "casa-sposa"):
        return casa(foto)
    if cap_id == "ristorante":
        return ristorante(foto)
    return [], set(), set()


def priorita(s, capitolo):
    """Punti in più: famiglia della sposa a casa della sposa, consegna del bouquet della suocera, foto spontanee."""
    extra = 0.0
    testo = (s["espressione"] + " " + s["note"]).lower()
    if capitolo == "casa-sposa" and ha(s, "famiglia") and "sposo" not in testo:
        extra += 1.0
    if ha(s, "suocera"):
        extra += 1.5
    if ha(s, "spontanea") and not ha(s, "posa"):
        extra += 0.3
    return extra
