import assert from "node:assert/strict";
import test from "node:test";
import {
  applyThumbnailViews,
  clearThumbnailViews,
  removeThumbnailViews,
  subscribeThumbnailView,
} from "./thumbnail-view-store";

const view = (url: string) => ({
  thumbnailUrl: url,
  width: 320,
  height: 240,
  orientation: "horizontal" as const,
  aspectRatio: 4 / 3,
});

test("notifica soltanto gli asset modificati", () => {
  clearThumbnailViews();
  let firstCalls = 0;
  let secondCalls = 0;
  const unsubscribeFirst = subscribeThumbnailView("first", () => { firstCalls += 1; });
  const unsubscribeSecond = subscribeThumbnailView("second", () => { secondCalls += 1; });

  applyThumbnailViews([["first", view("blob:first")]]);
  applyThumbnailViews([["first", view("blob:first")]]);
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 0);

  removeThumbnailViews(["first"]);
  assert.equal(firstCalls, 2);
  unsubscribeFirst();
  unsubscribeSecond();
  clearThumbnailViews();
});

test("clear invalida tutte e sole le viste presenti", () => {
  clearThumbnailViews();
  let calls = 0;
  const unsubscribe = subscribeThumbnailView("asset", () => { calls += 1; });
  applyThumbnailViews([["asset", view("blob:asset")]]);
  clearThumbnailViews();
  assert.equal(calls, 2);
  unsubscribe();
});
