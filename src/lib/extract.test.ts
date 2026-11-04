import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { extractBlocks } from "./extract.ts";
import { readFileSync } from "node:fs";
import { canBrowserTranslate, decideGooglePage, GOOGLE_IN_PAGE_FAILED } from "./google.ts";
import { computeFloatPosition } from "./layout.ts";
import { menuItems } from "./menu.ts";
import { classifySelection, shouldOfferSelection } from "./selection.ts";
import { defaultSettings, normalizeSettings } from "./settings.ts";

const html = `<!doctype html>
<html><head><title>Browser tab title</title></head>
<body>
  <nav><p>Menu item to skip from the chrome.</p></nav>
  <main>
    <h1>Large language models are changing how we read the web.</h1>
    <p>When a sentence matters, you can select it and get a careful translation.</p>
    <div><p>Unimportant pages stay untouched until you choose Google Translate yourself.</p></div>
    <ul><li><p>Nested item should be kept once.</p></li></ul>
    <pre>const secret = "do not translate code";</pre>
  </main>
  <aside><p>Aside notes should stay out of the bilingual reader.</p></aside>
  <footer><p>Footer text should stay out of the bilingual reader.</p></footer>
</body></html>`;

describe("extractBlocks", () => {
  it("keeps paragraph text, uses the h1 as title, and skips chrome", () => {
    const { document } = parseHTML(html);
    const result = extractBlocks(document);
    assert.equal(result.title, "Large language models are changing how we read the web.");
    const texts = result.blocks.map((block) => block.text);
    assert.deepEqual(texts, [
      "Large language models are changing how we read the web.",
      "When a sentence matters, you can select it and get a careful translation.",
      "Unimportant pages stay untouched until you choose Google Translate yourself.",
      "Nested item should be kept once.",
    ]);
    assert.equal(result.truncated, false);
  });

  it("skips a paragraph that was already replaced in place", () => {
    const { document } = parseHTML(`<main>
      <p id="a">Hello there, this is long enough to be a block of text for extraction.</p>
      <p id="b">Second paragraph is also long enough to extract as its own block of text.</p>
    </main>`);
    document.querySelector("#a")?.setAttribute("data-yifan-replaced", "");
    const result = extractBlocks(document);
    assert.deepEqual(result.blocks.map((block) => block.text), [
      "Second paragraph is also long enough to extract as its own block of text.",
    ]);
  });

  it("flags truncation at the limit", () => {
    const { document } = parseHTML(html);
    const result = extractBlocks(document, 1);
    assert.equal(result.blocks.length, 1);
    assert.equal(result.truncated, true);
  });

  it("collects a visible card title that is not a p or heading", () => {
    const { document } = parseHTML(`<body>
      <nav><a href="/explainers">Explainers</a></nav>
      <main>
        <nav><a href="/politics">Politics nav</a></nav>
        <p>Start Here</p>
        <ol><li>It's Election Day. You can find <a href="/midterms">Vox's coverage of the midterms here</a>. And the best place to keep up.</li></ol>
        <div class="card">
          <span class="kicker">Politics</span>
          <div class="title-wrap"><a href="/story">What <em>Democrats</em> could actually do if they win Congress</a></div>
          <p>They've made big promises. Here's a deep dive into what they could actually deliver.</p>
        </div>
        <div class="card">
          <div class="plain-title">Israel's Arab parties could end Netanyahu's rule</div>
        </div>
        <a hidden href="/secret">Secret headline that must stay out</a>
        <pre><div>const secret = "do not translate code"</div></pre>
      </main>
    </body>`);
    const result = extractBlocks(document);
    const texts = result.blocks.map((block) => block.text);
    assert.deepEqual(texts, [
      "Start Here",
      "It's Election Day. You can find Vox's coverage of the midterms here. And the best place to keep up.",
      "Politics",
      "What Democrats could actually do if they win Congress",
      "They've made big promises. Here's a deep dive into what they could actually deliver.",
      "Israel's Arab parties could end Netanyahu's rule",
    ]);
    const title = result.blocks.find((block) => block.text.startsWith("What Democrats"));
    const plain = result.blocks.find((block) => block.text.startsWith("Israel's Arab parties"));
    const item = result.blocks.find((block) => block.text.startsWith("It's Election Day"));
    assert.equal(title?.anchor.tagName, "A");
    assert.equal(title?.anchor.getAttribute("href"), "/story");
    assert.equal(plain?.anchor.tagName, "DIV");
    assert.equal(plain?.anchor.className, "plain-title");
    assert.equal(item?.anchor.tagName, "LI");
    assert.equal(result.blocks.some((block) => block.text === "Vox's coverage of the midterms here"), false);
    assert.equal(result.blocks.some((block) => block.text.includes("Explainers")), false);
    assert.equal(result.blocks.some((block) => block.text.includes("Politics nav")), false);
    assert.equal(result.blocks.some((block) => block.text.includes("Secret headline")), false);
    assert.equal(result.blocks.some((block) => block.text.includes("do not translate code")), false);
    const limited = extractBlocks(document, 1);
    assert.equal(limited.blocks[0]?.text, "Start Here");
    assert.equal(limited.truncated, true);
  });
});

describe("settings and selection", () => {
  it("defaults selection translate to on", () => {
    assert.equal(defaultSettings().selectionEnabled, true);
    assert.equal(normalizeSettings({}).selectionEnabled, true);
    assert.equal(normalizeSettings({ model: "bad model", apiKey: "  sk-1  " }).model, "qwen3.7-plus");
    assert.equal(normalizeSettings({ model: "qwen-plus" }).model, "qwen-plus");
    assert.equal(defaultSettings().model, "qwen3.7-plus");
    assert.equal(defaultSettings().selectionMode, "confirm");
    assert.equal(normalizeSettings({ apiKey: "  sk-1  " }).apiKey, "sk-1");
    assert.equal(normalizeSettings({ selectionEnabled: false }).selectionEnabled, false);
  });

  it("does not offer a float when the switch is off or the selection is empty", () => {
    assert.equal(shouldOfferSelection(true, "  hello "), true);
    assert.equal(shouldOfferSelection(false, "hello"), false);
    assert.equal(shouldOfferSelection(true, "   "), false);
    assert.equal(classifySelection("x".repeat(5001)), "too_long");
  });
});

describe("menu", () => {
  it("matches the approved context menu copy", () => {
    const titles = menuItems()
      .map((item) => item.title)
      .filter((title): title is string => Boolean(title));
    assert.deepEqual(titles, ["翻译选中内容", "整页 AI 翻译…", "整页谷歌翻译…", "框选识译…", "打开设置"]);
  });
});

describe("google translate stays on the page", () => {
  it("uses the in-page API when the browser has one, and never builds a navigation URL", () => {
    const ready = decideGooglePage({
      pageUrl: "https://example.com/a b",
      targetLang: "zh",
      inPageApi: true,
    });
    assert.deepEqual(ready, { ok: true, targetLanguage: "zh-CN" });
    assert.equal("url" in ready, false);
    assert.equal(JSON.stringify(ready).includes("https://"), false);

    const english = decideGooglePage({
      pageUrl: "https://example.com/post",
      targetLang: "en",
      inPageApi: true,
    });
    assert.deepEqual(english, { ok: true, targetLanguage: "en" });

    const missing = decideGooglePage({
      pageUrl: "https://example.com/post",
      targetLang: "zh",
      inPageApi: false,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.match(missing.message, /没有跳转到 translate\.google\.com/);
      assert.equal(missing.message.includes("https://"), false);
    }

    const special = decideGooglePage({
      pageUrl: "chrome://extensions",
      targetLang: "zh",
      inPageApi: true,
    });
    assert.equal(special.ok, false);
    if (!special.ok) assert.match(special.message, /没有跳转/);

    assert.equal(canBrowserTranslate("https://example.com/post"), true);
    assert.equal(canBrowserTranslate("chrome://extensions"), false);
    assert.equal(canBrowserTranslate("https://translate.google.com/translate"), false);
    assert.equal(canBrowserTranslate(undefined), false);
    assert.match(GOOGLE_IN_PAGE_FAILED, /没有跳转到 translate\.google\.com/);
    assert.equal(GOOGLE_IN_PAGE_FAILED.includes("https://translate.google.com"), false);

    const googleSource = readFileSync(new URL("./google.ts", import.meta.url), "utf8");
    const background = readFileSync(new URL("../background/index.ts", import.meta.url), "utf8");
    assert.equal(googleSource.includes("googleTranslateUrl"), false);
    assert.equal(googleSource.includes("translate.google.com/translate"), false);
    assert.equal(background.includes("chrome.tabs.update"), false);
    assert.equal(background.includes("googleTranslateUrl"), false);
    assert.equal(background.includes("translate.google.com/translate"), false);
  });
});

describe("float placement", () => {
  it("flips above the selection when there is no room below", () => {
    const pos = computeFloatPosition({
      rect: { left: 20, top: 500, bottom: 520, width: 100, height: 20 },
      card: { width: 380, height: 200 },
      viewport: { width: 800, height: 600 },
    });
    assert.equal(pos.left, 20);
    assert.equal(pos.top, 500 - 200 - 8);
  });

  it("clamps to the viewport", () => {
    const pos = computeFloatPosition({
      rect: { left: 900, top: 10, bottom: 30, width: 40, height: 20 },
      card: { width: 380, height: 160 },
      viewport: { width: 800, height: 600 },
    });
    assert.equal(pos.left, 800 - 380 - 8);
    assert.ok(pos.top >= 8);
  });
});
