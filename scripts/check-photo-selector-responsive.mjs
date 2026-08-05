import assert from "node:assert/strict";

const port = Number(process.argv[2] ?? 9333);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((candidate) => (
  candidate.type === "page"
  && typeof candidate.url === "string"
  && candidate.url.includes("photo-selector-app")
));
assert.ok(target?.webSocketDebuggerUrl, "PhotoSelector target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await send("Runtime.enable");
const widths = [1600, 1120, 900, 720, 520];
for (const width of widths) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const evaluation = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const header = document.querySelector('.app-header');
      const selectors = [
        '.app-header__identity',
        '.app-header__nav',
        '.app-header__primary-actions',
        '.app-header__context'
      ];
      const rects = selectors.map((selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? { selector, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
      }).filter(Boolean);
      const overlaps = [];
      for (let left = 0; left < rects.length; left += 1) {
        for (let right = left + 1; right < rects.length; right += 1) {
          const a = rects[left];
          const b = rects[right];
          if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) {
            overlaps.push(a.selector + ' / ' + b.selector);
          }
        }
      }
      const headerRect = header.getBoundingClientRect();
      const controlsOutside = [...header.querySelectorAll('button, input')]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < headerRect.left - 1 || rect.right > headerRect.right + 1;
        })
        .map((element) => element.textContent?.trim() || element.getAttribute('placeholder') || element.tagName);
      return {
        viewportWidth: innerWidth,
        headerClientWidth: header.clientWidth,
        headerScrollWidth: header.scrollWidth,
        overlaps,
        controlsOutside,
      };
    })()`,
  });
  const result = evaluation.result.value;
  assert.deepEqual(result.overlaps, [], `Header overlap at ${width}px`);
  assert.deepEqual(result.controlsOutside, [], `Header controls outside at ${width}px`);
  assert.ok(result.headerScrollWidth <= result.headerClientWidth + 1, `Header overflow at ${width}px`);
  console.log(`${width}px: PASS`);
}

const contextEvaluation = await send("Runtime.evaluate", {
  returnByValue: true,
  expression: `(() => ({
    projectName: document.querySelector('.app-header__project-name-value strong')?.textContent?.trim() ?? null,
    selectionTab: [...document.querySelectorAll('.app-header__tab')]
      .map((element) => element.textContent?.trim())
      .find((label) => label?.startsWith('Selezione')) ?? null,
    activeFolder: document.querySelector('.folder-diagnostics-panel__context span')?.textContent?.trim() ?? null
  }))()`,
});
console.log(JSON.stringify(contextEvaluation.result.value));

await send("Emulation.clearDeviceMetricsOverride");
socket.close();
