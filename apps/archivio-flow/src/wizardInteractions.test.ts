import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import type { ReactElement, ReactNode } from "react";
import { FolderStep } from "./components/steps/FolderStep.js";

(globalThis as { React?: typeof React }).React = React;

/** Cerca nell'albero degli elementi (senza DOM) i bottoni con il testo indicato. */
function findButtons(node: ReactNode, text: string, found: Array<{ props: { onClick?: () => void } }> = []): Array<{ props: { onClick?: () => void } }> {
  if (Array.isArray(node)) { node.forEach((child) => findButtons(child, text, found)); return found; }
  if (!React.isValidElement(node)) return found;
  const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  const content = React.Children.toArray(element.props.children).map((child) => (typeof child === "string" || typeof child === "number" ? String(child) : "")).join("");
  if (element.type === "button" && content.includes(text)) found.push(element as unknown as { props: { onClick?: () => void } });
  if (typeof element.type === "function") {
    try { findButtons((element.type as (props: unknown) => ReactNode)(element.props), text, found); } catch { /* componenti con hook: si ignorano */ }
  }
  findButtons(element.props.children, text, found);
  return found;
}

function render(props: Partial<Parameters<typeof FolderStep>[0]>) {
  const selected: string[] = [];
  const tree = FolderStep({
    photosText: "1 foto scelta", onChangePhotos: () => undefined, folders: ["Promessa"], presets: ["Chiesa", "Ristorante", "Promessa"], value: "",
    onChange: (value: string) => selected.push(value), similar: [], onBack: () => undefined, onNext: () => undefined, ...props,
  });
  return { tree, selected };
}

test("cartelle predefinite: un clic sul pulsante sceglie la cartella, sia per un lavoro nuovo sia per uno esistente", () => {
  for (const existingJobName of [undefined, "Romeo Comparone"]) {
    const { tree, selected } = render({ existingJobName });
    const [chiesa] = findButtons(tree, "Chiesa");
    assert.ok(chiesa, "il pulsante Chiesa esiste");
    chiesa!.props.onClick!();
    const [ristorante] = findButtons(tree, "Ristorante");
    ristorante!.props.onClick!();
    assert.deepEqual(selected, ["Chiesa", "Ristorante"], `lavoro ${existingJobName ?? "nuovo"}`);
  }
});

test("cartelle del lavoro già presenti e 'cartella principale' rispondono al clic", () => {
  const { tree, selected } = render({ existingJobName: "Romeo Comparone", value: "Chiesa" });
  findButtons(tree, "Promessa")[0]!.props.onClick!();
  findButtons(tree, "Cartella principale")[0]!.props.onClick!();
  assert.deepEqual(selected, ["Promessa", ""]);
});
