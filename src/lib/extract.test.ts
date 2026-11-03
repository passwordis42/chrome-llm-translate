import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { extractBlocks } from "./extract.ts";
import { googleTranslateUrl, canBrowserTranslate } from "./google.ts";
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
      "When a sentence matters, you can select it and get a careful translation.",
      "Unimportant pages stay untouched until you choose Google Translate yourself.",
      "Nested item should be kept once.",
    ]);
    assert.equal(result.truncated, false);
  });

  it("flags truncation at the limit", () => {
    const { document } = parseHTML(html);
    const result = extractBlocks(document, 1);
    assert.equal(result.blocks.length, 1);
    assert.equal(result.truncated, true);
  });
});

describe("settings and selection", () => {
  it("defaults selection translate to on", () => {
    assert.equal(defaultSettings().selectionEnabled, true);
    assert.equal(normalizeSettings({}).selectionEnabled, true);
    assert.equal(normalizeSettings({ model: "nope", apiKey: "  sk-1  " }).model, "qwen-plus");
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
    assert.deepEqual(titles, ["翻译选中内容", "整页 AI 翻译…", "整页谷歌翻译…", "打开设置"]);
  });
});

describe("google translate fallback", () => {
  it("builds a translate URL and refuses non-http pages", () => {
    const url = googleTranslateUrl("https://example.com/a b", "auto", "zh");
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "translate.google.com");
    assert.equal(parsed.searchParams.get("sl"), "auto");
    assert.equal(parsed.searchParams.get("tl"), "zh-CN");
    assert.equal(parsed.searchParams.get("u"), "https://example.com/a b");
    assert.equal(canBrowserTranslate("https://example.com/post"), true);
    assert.equal(canBrowserTranslate("chrome://extensions"), false);
    assert.equal(canBrowserTranslate("https://translate.google.com/translate"), false);
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
