import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";

const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XMP_NS = "http://ns.adobe.com/xap/1.0/";
const MICROSOFT_PHOTO_NS = "http://ns.microsoft.com/photo/1.0/";
const PHOTOSUITE_NS = "https://imagetool.local/ns/photosuite/1.0/";

export interface XmpState {
  rating?: number;
  pickStatus?: PickStatus;
  colorLabel?: ColorLabel | null;
  customLabels?: string[];
  selected?: boolean;
  hasCameraRawAdjustments: boolean;
  hasPhotoshopAdjustments: boolean;
}

function toColorLabel(value: string): ColorLabel | null {
  const v = value.trim().toLowerCase();
  if (v === "red") return "red";
  if (v === "yellow") return "yellow";
  if (v === "green") return "green";
  if (v === "blue") return "blue";
  if (v === "purple" || v === "magenta") return "purple";
  return null;
}

function toLabelValue(pickStatus: PickStatus, colorLabel: ColorLabel | null): string | null {
  if (pickStatus === "picked") return "Select";
  if (pickStatus === "rejected") return "Rejected";
  if (!colorLabel) return null;
  return colorLabel[0].toUpperCase() + colorLabel.slice(1);
}

function clampRating(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value)));
}

function normalizeCustomLabelName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 48);
}

function normalizeCustomLabels(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
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

function getDescriptionElement(doc: Document): Element {
  const byTag = doc.getElementsByTagNameNS(RDF_NS, "Description");
  if (byTag.length > 0) return byTag[0];

  const unprefixed = doc.getElementsByTagName("Description");
  if (unprefixed.length > 0) return unprefixed[0];

  const rdf = doc.createElementNS(RDF_NS, "rdf:RDF");
  const desc = doc.createElementNS(RDF_NS, "rdf:Description");
  desc.setAttributeNS(RDF_NS, "rdf:about", "");
  rdf.appendChild(desc);
  doc.documentElement.appendChild(rdf);
  return desc;
}

function getElementChildren(parent: Element): Element[] {
  return Array.from(parent.childNodes)
    .filter((node): node is Element => node.nodeType === 1);
}

function getDescriptionElements(doc: Document): Element[] {
  const byNamespace = Array.from(doc.getElementsByTagNameNS(RDF_NS, "Description"));
  if (byNamespace.length > 0) {
    return byNamespace;
  }
  return Array.from(doc.getElementsByTagName("rdf:Description"));
}

function isNamespacedProperty(
  node: Attr | Element,
  namespaceUri: string,
  prefix: string,
  localName: string,
): boolean {
  const resolvedLocalName = node.localName || node.nodeName.split(":").pop() || node.nodeName;
  return resolvedLocalName === localName
    && (node.namespaceURI === namespaceUri || node.nodeName === `${prefix}:${localName}`);
}

function removePropertyFromAllDescriptions(
  doc: Document,
  namespaceUri: string,
  prefix: string,
  localName: string,
): void {
  for (const description of getDescriptionElements(doc)) {
    for (const attr of Array.from(description.attributes)) {
      if (isNamespacedProperty(attr, namespaceUri, prefix, localName)) {
        description.removeAttributeNode(attr);
      }
    }
    for (const child of getElementChildren(description)) {
      if (isNamespacedProperty(child, namespaceUri, prefix, localName)) {
        description.removeChild(child);
      }
    }
  }
}

function findDirectChildByNamespace(parent: Element, namespaceUri: string, localName: string): Element | null {
  for (const child of getElementChildren(parent)) {
    const childLocalName = child.localName || child.tagName.split(":").pop() || child.tagName;
    if ((child.namespaceURI === namespaceUri || child.tagName === `photosuite:${localName}`) && childLocalName === localName) {
      return child;
    }
  }

  return null;
}

function readCustomLabels(el: Element): string[] | undefined {
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

function upsertCustomLabels(doc: Document, desc: Element, labels: string[]): void {
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

export function parseXmpState(xml: string): XmpState {
  const result: XmpState = { hasCameraRawAdjustments: false, hasPhotoshopAdjustments: false };

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return result;
  }

  if (doc.getElementsByTagName("parsererror").length > 0) return result;

  const descriptions = getDescriptionElements(doc);
  const applyRating = (value: string) => {
    const rating = Number.parseFloat(value);
    if (!Number.isFinite(rating)) {
      return;
    }
    if (rating < 0) {
      result.pickStatus = "rejected";
    } else {
      result.rating = clampRating(rating);
    }
  };
  const applyLabel = (value: string) => {
    const lv = value.trim().toLowerCase();
    if (lv === "select" || lv === "picked") result.pickStatus = "picked";
    if (lv === "reject" || lv === "rejected") result.pickStatus = "rejected";
    const color = toColorLabel(value);
    if (color) result.colorLabel = color;
  };

  for (const el of descriptions) {
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      const localName = attr.localName || attr.name.split(":").pop() || attr.name;
      const value = attr.value;

      if (isNamespacedProperty(attr, XMP_NS, "xmp", "Rating")) {
        applyRating(value);
      }

      if (isNamespacedProperty(attr, PHOTOSUITE_NS, "photosuite", "Rejected")) {
        const rv = value.trim().toLowerCase();
        if (rv === "true" || rv === "1" || rv === "yes") {
          result.pickStatus = "rejected";
        }
      }

      if (isNamespacedProperty(attr, PHOTOSUITE_NS, "photosuite", "PreservedRating")) {
        const preserved = Number.parseInt(value, 10);
        if (Number.isFinite(preserved) && preserved >= 0) {
          result.rating = clampRating(preserved);
        }
      }

      if (isNamespacedProperty(attr, XMP_NS, "xmp", "Label")) {
        applyLabel(value);
      }

      if (isNamespacedProperty(attr, PHOTOSUITE_NS, "photosuite", "Pick")) {
        const pick = Number.parseInt(value, 10);
        if (pick > 0) result.pickStatus = "picked";
        else if (pick < 0) result.pickStatus = "rejected";
      }

      if (isNamespacedProperty(attr, PHOTOSUITE_NS, "photosuite", "Selected")) {
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

    for (const child of getElementChildren(el)) {
      const value = child.textContent ?? "";
      if (isNamespacedProperty(child, XMP_NS, "xmp", "Rating")) {
        applyRating(value);
      } else if (isNamespacedProperty(child, XMP_NS, "xmp", "Label")) {
        applyLabel(value);
      }
    }

    const customLabels = readCustomLabels(el);
    if (customLabels !== undefined) {
      result.customLabels = customLabels;
    }
  }

  return result;
}

export function upsertXmpState(
  existingXml: string | null,
  asset: ImageAsset,
  selected: boolean,
): string {
  const fallbackXml = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">\n  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n    <rdf:Description rdf:about="" xmlns:xmp="${XMP_NS}" xmlns:photosuite="${PHOTOSUITE_NS}"/>\n  </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>`;

  const sourceXml = existingXml && existingXml.trim().length > 0 ? existingXml : fallbackXml;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(sourceXml, "application/xml");
  } catch {
    doc = new DOMParser().parseFromString(fallbackXml, "application/xml");
  }

  if (doc.getElementsByTagName("parsererror").length > 0) {
    doc = new DOMParser().parseFromString(fallbackXml, "application/xml");
  }

  const desc = getDescriptionElement(doc);

  const numericRating = clampRating(asset.rating ?? 0);
  const isRejected = asset.pickStatus === "rejected";
  // Per compatibilità con Adobe (Bridge/Lightroom) usiamo xmp:Rating = -1 per "rejected",
  // ma preserviamo il valore numerico in photosuite:PreservedRating per round-trip senza perdita.
  const ratingValue = isRejected ? -1 : numericRating;
  removePropertyFromAllDescriptions(doc, XMP_NS, "xmp", "Rating");
  // Bridge elimina la vecchia scala Microsoft (1/25/50/75/99) quando assegna
  // una stella Adobe. Lasciarla nel pacchetto produce letture conflittuali.
  removePropertyFromAllDescriptions(doc, MICROSOFT_PHOTO_NS, "MicrosoftPhoto", "Rating");
  desc.setAttributeNS(XMP_NS, "xmp:Rating", String(ratingValue));

  if (isRejected && numericRating > 0) {
    desc.setAttributeNS(PHOTOSUITE_NS, "photosuite:PreservedRating", String(numericRating));
  } else {
    desc.removeAttribute("photosuite:PreservedRating");
    desc.removeAttributeNS(PHOTOSUITE_NS, "PreservedRating");
  }

  desc.setAttributeNS(PHOTOSUITE_NS, "photosuite:Rejected", isRejected ? "True" : "False");

  const labelValue = toLabelValue(asset.pickStatus ?? "unmarked", asset.colorLabel ?? null);
  removePropertyFromAllDescriptions(doc, XMP_NS, "xmp", "Label");
  if (labelValue) {
    desc.setAttributeNS(XMP_NS, "xmp:Label", labelValue);
  } else {
    desc.removeAttribute("xmp:Label");
    desc.removeAttributeNS(XMP_NS, "Label");
  }

  desc.setAttributeNS(PHOTOSUITE_NS, "photosuite:Selected", selected ? "True" : "False");
  upsertCustomLabels(doc, desc, normalizeCustomLabels(asset.customLabels));

  return new XMLSerializer().serializeToString(doc);
}
