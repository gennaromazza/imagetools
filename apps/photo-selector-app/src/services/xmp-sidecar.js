const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XMP_NS = "http://ns.adobe.com/xap/1.0/";
const PHOTOSUITE_NS = "https://imagetool.local/ns/photosuite/1.0/";
function toColorLabel(value) {
    const v = value.trim().toLowerCase();
    if (v === "red")
        return "red";
    if (v === "yellow")
        return "yellow";
    if (v === "green")
        return "green";
    if (v === "blue")
        return "blue";
    if (v === "purple" || v === "magenta")
        return "purple";
    return null;
}
function toLabelValue(pickStatus, colorLabel) {
    if (pickStatus === "picked")
        return "Select";
    if (pickStatus === "rejected")
        return "Rejected";
    if (!colorLabel)
        return null;
    return colorLabel[0].toUpperCase() + colorLabel.slice(1);
}
function clampRating(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(0, Math.min(5, Math.round(value)));
}
function normalizeCustomLabelName(value) {
    return value.replace(/\s+/g, " ").trim().slice(0, 48);
}
function normalizeCustomLabels(values) {
    if (!values || values.length === 0) {
        return [];
    }
    const seen = new Set();
    const normalized = [];
    for (const value of values) {
        const cleaned = normalizeCustomLabelName(value);
        if (!cleaned) {
            continue;
        }
        const key = cleaned.toLocaleLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        normalized.push(cleaned);
    }
    return normalized;
}
function getDescriptionElement(doc) {
    const byTag = doc.getElementsByTagName("rdf:Description");
    if (byTag.length > 0)
        return byTag[0];
    const about = doc.querySelector("Description");
    if (about)
        return about;
    const rdf = doc.createElementNS(RDF_NS, "rdf:RDF");
    const desc = doc.createElementNS(RDF_NS, "rdf:Description");
    desc.setAttributeNS(RDF_NS, "rdf:about", "");
    rdf.appendChild(desc);
    doc.documentElement.appendChild(rdf);
    return desc;
}
function findDirectChildByNamespace(parent, namespaceUri, localName) {
    for (const child of Array.from(parent.children)) {
        const childLocalName = child.localName || child.tagName.split(":").pop() || child.tagName;
        if ((child.namespaceURI === namespaceUri || child.tagName === `photosuite:${localName}`) && childLocalName === localName) {
            return child;
        }
    }
    return null;
}
function readCustomLabels(el) {
    const container = findDirectChildByNamespace(el, PHOTOSUITE_NS, "CustomLabels");
    if (!container) {
        return undefined;
    }
    const values = Array.from(container.getElementsByTagNameNS(RDF_NS, "li"))
        .map((node) => node.textContent ?? "")
        .map((value) => normalizeCustomLabelName(value))
        .filter(Boolean);
    return normalizeCustomLabels(values);
}
function upsertCustomLabels(doc, desc, labels) {
    const existing = findDirectChildByNamespace(desc, PHOTOSUITE_NS, "CustomLabels");
    if (labels.length === 0) {
        existing?.remove();
        desc.removeAttribute("photosuite:CustomLabels");
        desc.removeAttributeNS(PHOTOSUITE_NS, "CustomLabels");
        return;
    }
    const container = existing ?? doc.createElementNS(PHOTOSUITE_NS, "photosuite:CustomLabels");
    if (!existing) {
        desc.appendChild(container);
    }
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }
    const bag = doc.createElementNS(RDF_NS, "rdf:Bag");
    for (const label of labels) {
        const item = doc.createElementNS(RDF_NS, "rdf:li");
        item.textContent = label;
        bag.appendChild(item);
    }
    container.appendChild(bag);
}
export function parseXmpState(xml) {
    const result = { hasCameraRawAdjustments: false, hasPhotoshopAdjustments: false };
    let doc;
    try {
        doc = new DOMParser().parseFromString(xml, "application/xml");
    }
    catch {
        return result;
    }
    const parseErr = doc.querySelector("parsererror");
    if (parseErr)
        return result;
    const descriptions = Array.from(doc.getElementsByTagName("rdf:Description"));
    for (const el of descriptions) {
        for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            const localName = attr.localName || attr.name.split(":").pop() || attr.name;
            const value = attr.value;
            if (localName === "Rating") {
                const rating = Number.parseInt(value, 10);
                if (Number.isFinite(rating)) {
                    if (rating < 0) {
                        result.pickStatus = "rejected";
                    }
                    else {
                        result.rating = clampRating(rating);
                    }
                }
            }
            if (localName === "Rejected") {
                const rv = value.trim().toLowerCase();
                if (rv === "true" || rv === "1" || rv === "yes") {
                    result.pickStatus = "rejected";
                }
            }
            if (localName === "PreservedRating") {
                const preserved = Number.parseInt(value, 10);
                if (Number.isFinite(preserved) && preserved >= 0) {
                    result.rating = clampRating(preserved);
                }
            }
            if (localName === "Label") {
                const lv = value.trim().toLowerCase();
                if (lv === "select" || lv === "picked")
                    result.pickStatus = "picked";
                if (lv === "reject" || lv === "rejected")
                    result.pickStatus = "rejected";
                const color = toColorLabel(value);
                if (color)
                    result.colorLabel = color;
            }
            if (localName === "Pick") {
                const pick = Number.parseInt(value, 10);
                if (pick > 0)
                    result.pickStatus = "picked";
                else if (pick < 0)
                    result.pickStatus = "rejected";
            }
            if (localName === "Selected") {
                const sv = value.trim().toLowerCase();
                result.selected = sv === "1" || sv === "true" || sv === "yes";
            }
            if ((attr.prefix === "crs" || attr.name.startsWith("crs:")) && localName !== "Version") {
                result.hasCameraRawAdjustments = true;
            }
            if ((attr.namespaceURI ?? "").toLowerCase().includes("camera-raw-settings")) {
                result.hasCameraRawAdjustments = true;
            }
            if (attr.prefix === "photoshop" || attr.name.startsWith("photoshop:")) {
                result.hasPhotoshopAdjustments = true;
            }
            if ((attr.namespaceURI ?? "").toLowerCase().includes("photoshop/1.0")) {
                result.hasPhotoshopAdjustments = true;
            }
        }
        const customLabels = readCustomLabels(el);
        if (customLabels !== undefined) {
            result.customLabels = customLabels;
        }
    }
    return result;
}
export function upsertXmpState(existingXml, asset, selected) {
    const fallbackXml = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">\n  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n    <rdf:Description rdf:about="" xmlns:xmp="${XMP_NS}" xmlns:photosuite="${PHOTOSUITE_NS}"/>\n  </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>`;
    const sourceXml = existingXml && existingXml.trim().length > 0 ? existingXml : fallbackXml;
    let doc;
    try {
        doc = new DOMParser().parseFromString(sourceXml, "application/xml");
    }
    catch {
        doc = new DOMParser().parseFromString(fallbackXml, "application/xml");
    }
    if (doc.querySelector("parsererror")) {
        doc = new DOMParser().parseFromString(fallbackXml, "application/xml");
    }
    const desc = getDescriptionElement(doc);
    const numericRating = clampRating(asset.rating ?? 0);
    const isRejected = asset.pickStatus === "rejected";
    // Per compatibilità con Adobe (Bridge/Lightroom) usiamo xmp:Rating = -1 per "rejected",
    // ma preserviamo il valore numerico in photosuite:PreservedRating per round-trip senza perdita.
    const ratingValue = isRejected ? -1 : numericRating;
    desc.setAttributeNS(XMP_NS, "xmp:Rating", String(ratingValue));
    if (isRejected && numericRating > 0) {
        desc.setAttributeNS(PHOTOSUITE_NS, "photosuite:PreservedRating", String(numericRating));
    }
    else {
        desc.removeAttribute("photosuite:PreservedRating");
        desc.removeAttributeNS(PHOTOSUITE_NS, "PreservedRating");
    }
    desc.setAttributeNS(PHOTOSUITE_NS, "photosuite:Rejected", isRejected ? "True" : "False");
    const labelValue = toLabelValue(asset.pickStatus ?? "unmarked", asset.colorLabel ?? null);
    if (labelValue) {
        desc.setAttributeNS(XMP_NS, "xmp:Label", labelValue);
    }
    else {
        desc.removeAttribute("xmp:Label");
        desc.removeAttributeNS(XMP_NS, "Label");
    }
    desc.setAttributeNS(PHOTOSUITE_NS, "photosuite:Selected", selected ? "True" : "False");
    upsertCustomLabels(doc, desc, normalizeCustomLabels(asset.customLabels));
    return new XMLSerializer().serializeToString(doc);
}
//# sourceMappingURL=xmp-sidecar.js.map