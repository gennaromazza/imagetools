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
function getDescriptionElement(doc) {
    const byTag = doc.getElementsByTagName("rdf:Description");
    if (byTag.length > 0)
        return byTag[0];
    const about = doc.querySelector("Description");
    if (about)
        return about;
    const rdf = doc.createElementNS("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "rdf:RDF");
    const desc = doc.createElementNS("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "rdf:Description");
    desc.setAttributeNS("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "rdf:about", "");
    rdf.appendChild(desc);
    doc.documentElement.appendChild(rdf);
    return desc;
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
    const ratingValue = asset.pickStatus === "rejected" ? -1 : clampRating(asset.rating ?? 0);
    desc.setAttributeNS(XMP_NS, "xmp:Rating", String(ratingValue));
    const labelValue = toLabelValue(asset.pickStatus ?? "unmarked", asset.colorLabel ?? null);
    if (labelValue) {
        desc.setAttributeNS(XMP_NS, "xmp:Label", labelValue);
    }
    else {
        desc.removeAttribute("xmp:Label");
        desc.removeAttributeNS(XMP_NS, "Label");
    }
    desc.setAttributeNS(PHOTOSUITE_NS, "photosuite:Selected", selected ? "True" : "False");
    return new XMLSerializer().serializeToString(doc);
}
//# sourceMappingURL=xmp-sidecar.js.map