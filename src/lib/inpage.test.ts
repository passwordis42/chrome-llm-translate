import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { extractBlocks } from "./extract.ts";
import { clearInsertedTranslations, inlineTarget, insertTranslationsBelow } from "./inpage.ts";

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

describe("insert translations below paragraphs", () => {
  it("keeps the source text and places a slot after each block", () => {
    const { document } = parseHTML(html);
    document.documentElement.style.overflow = "scroll";
    const extracted = extractBlocks(document);
    const sample = document.querySelector("#sample");
    const second = document.querySelector("#second");
    const link = document.querySelector<HTMLAnchorElement>("#stay-link");
    const nested = document.querySelector("#nested");
    const heading = document.querySelector("h1");
    assert.ok(sample && second && link && nested && heading);

    const sampleText = sample.textContent;
    const slots = insertTranslationsBelow(extracted.blocks);
    assert.equal(slots.length, extracted.blocks.length);
    assert.equal(sample.textContent, sampleText);
    assert.equal(sample.nextElementSibling?.getAttribute("data-yifan-inline"), extracted.blocks[0].id);
    assert.equal(sample.nextElementSibling?.nextElementSibling, second);
    assert.equal(second.nextElementSibling?.getAttribute("data-yifan-inline"), extracted.blocks[1].id);
    assert.equal(nested.nextElementSibling?.getAttribute("data-yifan-inline"), extracted.blocks[2].id);
    assert.equal(nested.parentElement?.contains(nested.nextElementSibling ?? null), true);
    assert.equal(heading.nextElementSibling, sample);
    assert.equal(document.querySelector("nav p")?.nextElementSibling, null);
    assert.equal(document.getElementById("yifan-page"), null);
    assert.equal(document.querySelector(".stage"), null);
    assert.equal(document.documentElement.style.overflow, "scroll");
    assert.notEqual(slots[0].style.position, "fixed");
    assert.notEqual(slots[0].style.position, "absolute");
    assert.equal(sample.contains(slots[0]), false);
    assert.equal(link.closest("[data-yifan-inline]"), null);
    assert.equal(inlineTarget(slots[0])?.dataset.state, "pending");
    assert.match(slots[0].textContent ?? "", /译文/);
    assert.equal(sample.textContent?.includes("翻译中"), false);

    const again = extractBlocks(document);
    assert.deepEqual(again.blocks.map((block) => block.text), extracted.blocks.map((block) => block.text));

    let hits = 0;
    link.addEventListener("click", () => {
      hits += 1;
    });
    const view = document.defaultView;
    assert.ok(view);
    const click = () => link.dispatchEvent(new view.Event("click", { bubbles: true }));
    click();
    assert.equal(hits, 1);

    assert.equal(clearInsertedTranslations(document), extracted.blocks.length);
    assert.equal(document.querySelector("[data-yifan-inline]"), null);
    assert.equal(sample.isConnected, true);
    assert.equal(sample.textContent, sampleText);
    assert.equal(sample.nextElementSibling, second);
    assert.equal(link.isConnected, true);
    click();
    assert.equal(hits, 2);
    assert.equal(document.documentElement.style.overflow, "scroll");
    assert.equal(clearInsertedTranslations(document), 0);
  });

  it("stacks split parts of the same paragraph in order and skips detached nodes", () => {
    const { document } = parseHTML(`<p id="p">One paragraph.</p>`);
    const paragraph = document.querySelector("#p");
    assert.ok(paragraph);
    const orphan = document.createElement("p");
    const slots = insertTranslationsBelow([
      { id: "b0", anchor: paragraph },
      { id: "b1", anchor: paragraph },
      { id: "gone", anchor: orphan },
    ]);
    assert.deepEqual(slots.map((slot) => slot.getAttribute("data-yifan-inline")), ["b0", "b1"]);
    assert.equal(paragraph.nextElementSibling?.getAttribute("data-yifan-inline"), "b0");
    assert.equal(paragraph.nextElementSibling?.nextElementSibling?.getAttribute("data-yifan-inline"), "b1");
    assert.equal(paragraph.textContent, "One paragraph.");
  });
});

describe("page translation does not mount an overlay", () => {
  it("inserts under paragraphs and does not lock or navigate for Google", () => {
    const pageview = readFileSync(new URL("../content/pageview.ts", import.meta.url), "utf8");
    const css = readFileSync(new URL("../content/content.css", import.meta.url), "utf8");
    const content = readFileSync(new URL("../content/index.ts", import.meta.url), "utf8");
    const background = readFileSync(new URL("../background/index.ts", import.meta.url), "utf8");
    assert.match(pageview, /insertTranslationsBelow/);
    assert.match(pageview, /clearInsertedTranslations/);
    assert.equal(pageview.includes("lockPageScroll"), false);
    assert.equal(pageview.includes("yifan-page"), false);
    assert.equal(pageview.includes("openSideBySide"), false);
    assert.equal(pageview.includes("整页 AI 对照阅读"), false);
    assert.equal(css.includes("yifan-page"), false);
    assert.equal(content.includes("openSideBySide"), false);
    assert.equal(content.includes("yifan-page"), false);
    assert.equal(background.includes("chrome.tabs.update"), false);
    assert.equal(background.includes("googleTranslateUrl"), false);
    assert.equal(background.includes("translate.google.com/translate"), false);
    assert.match(background, /decideGooglePage/);
  });
});
