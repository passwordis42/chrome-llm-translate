import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { extractBlocks } from "./extract.ts";
import {
  CONFIRM_DETAIL,
  CONFIRM_EMPHASIS,
  CONFIRM_LEAD,
  PAGE_BATCH_LIMIT,
  SCROLL_HINT,
  TOOLBAR_META,
  collectReplacedText,
  ensureSnapshot,
  isInViewport,
  nextVisibleBatch,
  replaceInPlace,
  restoreSnapshots,
  type TextSnapshot,
} from "./inpage.ts";

const html = `<!doctype html>
<html><head><title>Browser tab title</title></head>
<body>
  <nav><p>Menu item to skip from the chrome.</p></nav>
  <main>
    <h1>Large language models are changing how we read the web.</h1>
    <p id="sample">When a sentence matters, you can select it and get a careful translation.</p>
    <p id="second">Unimportant pages stay untouched until you choose Google Translate yourself. <a id="stay-link" href="#still-here">Still here</a></p>
    <ul><li><p id="nested">Nested item should be kept once.</p></li></ul>
    <pre>const secret = "do not translate code";</pre>
  </main>
  <aside><p>Aside notes should stay out of the bilingual reader.</p></aside>
  <footer><p>Footer text should stay out of the bilingual reader.</p></footer>
</body></html>`;

describe("replace translations in place", () => {
  it("swaps the block text, keeps the node, and restores the original markup", () => {
    const { document } = parseHTML(html);
    document.documentElement.style.overflow = "scroll";
    const extracted = extractBlocks(document);
    const sample = document.querySelector("#sample");
    const second = document.querySelector("#second");
    const link = document.querySelector<HTMLAnchorElement>("#stay-link");
    const nested = document.querySelector("#nested");
    const heading = document.querySelector("h1");
    assert.ok(sample && second && link && nested && heading);

    const sampleHtml = sample.innerHTML;
    const secondHtml = second.innerHTML;
    const childCount = second.parentElement?.childElementCount ?? 0;
    const store = new Map<Element, TextSnapshot>();
    const sampleSnap = ensureSnapshot(store, sample);
    const secondSnap = ensureSnapshot(store, second);
    const nestedSnap = ensureSnapshot(store, nested);
    assert.ok(sampleSnap && secondSnap && nestedSnap);
    assert.equal(ensureSnapshot(store, second), secondSnap);
    assert.equal(secondSnap.html, secondHtml);

    replaceInPlace(sampleSnap, "某句话真正重要时，可以划选它。");
    replaceInPlace(secondSnap, "不重要的页面保持原样。");
    replaceInPlace(nestedSnap, "嵌套项只保留一次。");

    assert.equal(sample.textContent, "某句话真正重要时，可以划选它。");
    assert.equal(second.textContent, "不重要的页面保持原样。");
    assert.equal(sample.getAttribute("data-yifan-replaced"), "");
    assert.equal(sample.isConnected, true);
    assert.equal(sample.nextElementSibling, second);
    assert.equal(second.parentElement?.childElementCount, childCount);
    assert.equal(document.querySelector("[data-yifan-inline]"), null);
    assert.equal(document.getElementById("yifan-page"), null);
    assert.equal(document.querySelector(".stage"), null);
    assert.equal(sample.querySelector("*"), null);
    assert.equal(document.body.textContent?.includes("译文"), false);
    assert.equal(link.isConnected, false);
    assert.equal(heading.textContent?.includes("Large language models"), true);
    assert.equal(document.documentElement.style.overflow, "scroll");
    assert.deepEqual(collectReplacedText(extracted.blocks.map((block) => block.anchor)), [
      "某句话真正重要时，可以划选它。",
      "不重要的页面保持原样。",
      "嵌套项只保留一次。",
    ]);

    const again = extractBlocks(document);
    assert.equal(again.blocks.some((block) => block.anchor === sample), false);

    assert.equal(restoreSnapshots([...store.values()]), 3);
    assert.equal(sample.innerHTML, sampleHtml);
    assert.equal(second.innerHTML, secondHtml);
    assert.equal(sample.hasAttribute("data-yifan-replaced"), false);
    assert.equal(document.querySelector("[data-yifan-replaced]"), null);
    const restored = document.querySelector<HTMLAnchorElement>("#stay-link");
    assert.ok(restored);
    let hits = 0;
    restored.addEventListener("click", () => {
      hits += 1;
    });
    const view = document.defaultView;
    assert.ok(view);
    restored.dispatchEvent(new view.Event("click", { bubbles: true }));
    assert.equal(hits, 1);
    assert.equal(document.documentElement.style.overflow, "scroll");
    assert.equal(restoreSnapshots([...store.values()]), 3);
  });

  it("joins split parts on the same node and skips detached anchors", () => {
    const { document } = parseHTML(`<p id="p">One paragraph.</p>`);
    const paragraph = document.querySelector("#p");
    assert.ok(paragraph);
    const orphan = document.createElement("p");
    orphan.textContent = "gone";
    const store = new Map<Element, TextSnapshot>();
    const snap = ensureSnapshot(store, paragraph);
    assert.ok(snap);
    assert.equal(ensureSnapshot(store, orphan), null);
    assert.equal(
      nextVisibleBatch([{ id: "gone", anchor: orphan }], { isVisible: () => true }).length,
      0,
    );
    replaceInPlace(snap, "甲");
    replaceInPlace(snap, "甲\n\n乙");
    assert.equal(paragraph.textContent, "甲\n\n乙");
    assert.equal(paragraph.childElementCount, 0);
    assert.equal(store.get(paragraph)?.html, "One paragraph.");
    assert.deepEqual(collectReplacedText([paragraph, paragraph]), ["甲\n\n乙"]);
    restoreSnapshots([snap]);
    assert.equal(paragraph.textContent, "One paragraph.");
    assert.equal(paragraph.hasAttribute("data-yifan-replaced"), false);
  });
});

describe("visible batches continue past 200", () => {
  it("caps a batch at 200 and returns the rest on the next call", () => {
    const { document } = parseHTML("<body></body>");
    const blocks = Array.from({ length: 230 }, (_, index) => {
      const anchor = document.createElement("p");
      anchor.id = `p${index}`;
      anchor.textContent = `Paragraph ${index} has enough letters.`;
      document.body.append(anchor);
      return { id: `b${index}`, anchor };
    });
    assert.equal(PAGE_BATCH_LIMIT, 200);
    const first = nextVisibleBatch(blocks, { isVisible: () => true });
    assert.equal(first.length, 200);
    assert.equal(first[0]?.id, "b0");
    assert.equal(first[199]?.id, "b199");
    const done = new Set(first.map((block) => block.id));
    const second = nextVisibleBatch(blocks, { done, isVisible: () => true });
    assert.equal(second.length, 30);
    assert.equal(second[0]?.id, "b200");
    assert.equal(second[29]?.id, "b229");
  });

  it("translates only the visible blocks, then the ones a scroll reveals", () => {
    const { document } = parseHTML("<body></body>");
    const blocks = Array.from({ length: 5 }, (_, index) => {
      const anchor = document.createElement("p");
      anchor.id = `p${index}`;
      anchor.textContent = `Paragraph ${index} has enough letters.`;
      document.body.append(anchor);
      return { id: `b${index}`, anchor };
    });
    const shown = new Set(["p0", "p1"]);
    const isVisible = (anchor: Element) => shown.has(anchor.id);
    const first = nextVisibleBatch(blocks, { isVisible });
    assert.deepEqual(first.map((block) => block.id), ["b0", "b1"]);
    const done = new Set(first.map((block) => block.id));
    const queued = new Set(["b2"]);
    shown.add("p2");
    shown.add("p3");
    assert.deepEqual(
      nextVisibleBatch(blocks, { done, queued, isVisible }).map((block) => block.id),
      ["b3"],
    );
    queued.delete("b2");
    assert.deepEqual(
      nextVisibleBatch(blocks, { done, queued, isVisible }).map((block) => block.id),
      ["b2", "b3"],
    );
    assert.equal(nextVisibleBatch(blocks, { done, isVisible: () => false }).length, 0);
  });

  it("treats a block as visible only when its box meets the viewport", () => {
    const viewport = { width: 800, height: 600 };
    assert.equal(
      isInViewport({ top: 10, bottom: 40, left: 8, right: 200, width: 192, height: 30 }, viewport),
      true,
    );
    assert.equal(
      isInViewport({ top: -20, bottom: 16, left: 0, right: 40, width: 40, height: 36 }, viewport),
      true,
    );
    assert.equal(
      isInViewport({ top: 640, bottom: 700, left: 0, right: 40, width: 40, height: 60 }, viewport),
      false,
    );
    assert.equal(
      isInViewport({ top: 10, bottom: 40, left: 820, right: 900, width: 80, height: 30 }, viewport),
      false,
    );
    assert.equal(
      isInViewport({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }, viewport),
      false,
    );
    assert.equal(
      isInViewport({ top: 0, bottom: 20, left: 0, right: 20, width: 20, height: 20 }, { width: 0, height: 0 }),
      false,
    );
  });
});

describe("page translation copy and behavior", () => {
  it("uses the approved toolbar and confirm copy, and does not insert slots", () => {
    assert.equal(TOOLBAR_META, "译文直接替换原文；下滑自动续翻；清除可还原");
    assert.equal(SCROLL_HINT, "继续下滑将自动续翻未译段落（每批最多 200 段）");
    assert.equal(`${CONFIRM_LEAD}${CONFIRM_EMPHASIS}？`, "用千问把整页原位替换为译文？");
    assert.equal(
      CONFIRM_DETAIL,
      "可见区直接换成译文；下滑露出新字自动续翻（每批最多 200 段）；可一键清除还原原文。",
    );

    const pageview = readFileSync(new URL("../content/pageview.ts", import.meta.url), "utf8");
    const confirm = readFileSync(new URL("../content/confirm.ts", import.meta.url), "utf8");
    const css = readFileSync(new URL("../content/content.css", import.meta.url), "utf8");
    const content = readFileSync(new URL("../content/index.ts", import.meta.url), "utf8");
    const background = readFileSync(new URL("../background/index.ts", import.meta.url), "utf8");
    const dom = readFileSync(new URL("../content/dom.ts", import.meta.url), "utf8");

    assert.match(pageview, /TOOLBAR_META/);
    assert.match(pageview, /SCROLL_HINT/);
    assert.match(pageview, /replaceInPlace/);
    assert.match(pageview, /restoreSnapshots/);
    assert.match(pageview, /nextVisibleBatch/);
    assert.match(pageview, /PAGE_BATCH_LIMIT/);
    assert.match(pageview, /IntersectionObserver/);
    assert.match(pageview, /复制全部译文/);
    assert.match(pageview, /清除译文/);
    assert.equal(pageview.includes("insertTranslationsBelow"), false);
    assert.equal(pageview.includes("data-yifan-inline"), false);
    assert.equal(pageview.includes("退出对照"), false);
    assert.equal(pageview.includes("段落下方"), false);
    assert.equal(pageview.includes("译文在段落下"), false);
    assert.equal(pageview.includes("lockPageScroll"), false);
    assert.equal(pageview.includes("yifan-page"), false);
    assert.equal(pageview.includes("openSideBySide"), false);
    assert.equal(pageview.includes("整页 AI 对照阅读"), false);

    assert.match(confirm, /CONFIRM_LEAD/);
    assert.match(confirm, /CONFIRM_EMPHASIS/);
    assert.match(confirm, /CONFIRM_DETAIL/);
    assert.match(confirm, /确认翻译/);
    assert.equal(confirm.includes("段落下方"), false);
    assert.equal(confirm.includes("退出对照"), false);
    assert.equal(dom.includes("data-yifan-inline"), false);
    assert.equal(css.includes("yifan-page"), false);
    assert.equal(content.includes("openSideBySide"), false);
    assert.equal(content.includes("yifan-page"), false);
    assert.equal(background.includes("chrome.tabs.update"), false);
    assert.equal(background.includes("googleTranslateUrl"), false);
    assert.equal(background.includes("translate.google.com/translate"), false);
    assert.match(background, /decideGooglePage/);
  });
});
