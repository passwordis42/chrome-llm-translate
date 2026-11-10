import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { menuItems } from "./menu.ts";
import { selectionOffer } from "./selection.ts";
import { defaultSettings, normalizeSettings, shouldRewriteSettings } from "./settings.ts";

describe("v0.1.13 selection translates immediately", () => {
  it("translates a non-empty selection when the switch is on, and stays quiet when it is off", () => {
    assert.equal(selectionOffer({ selectionEnabled: true, text: "hello" }), "translate");
    assert.equal(selectionOffer({ selectionEnabled: true, text: "  hello \nworld " }), "translate");
    assert.equal(selectionOffer({ selectionEnabled: true, text: "x".repeat(5001) }), "translate");
    assert.equal(selectionOffer({ selectionEnabled: false, text: "hello" }), "none");
    assert.equal(selectionOffer({ selectionEnabled: true, text: "   " }), "none");
    assert.equal(defaultSettings().selectionEnabled, true);
  });

  it("ignores a stored confirm or immediate mode and rewrites it away", () => {
    const base = {
      provider: "qwen",
      providers: {
        qwen: { apiKey: "sk-1", model: "qwen3.7-plus", visionModel: "qwen3-vl-plus" },
      },
      apiKey: "sk-1",
      model: "qwen3.7-plus",
      sourceLang: "en",
      targetLang: "ja",
      selectionEnabled: true,
      forceSelectEnabled: true,
      gestureEnabled: false,
      glossary: [{ id: "1", source: "API", target: "接口" }],
    };
    for (const selectionMode of ["confirm", "immediate", "nope"]) {
      const raw = { ...base, selectionMode };
      assert.equal(shouldRewriteSettings(raw), true, selectionMode);
      const settings = normalizeSettings(raw);
      assert.equal(Object.prototype.hasOwnProperty.call(settings, "selectionMode"), false);
      assert.equal(JSON.stringify(settings).includes("selectionMode"), false);
      assert.equal(settings.selectionEnabled, true);
      assert.equal(settings.forceSelectEnabled, true);
      assert.equal(settings.gestureEnabled, false);
      assert.equal(settings.sourceLang, "en");
      assert.equal(settings.targetLang, "ja");
      assert.equal(settings.apiKey, "sk-1");
      assert.equal(settings.glossary[0]?.target, "接口");
      assert.equal(selectionOffer({ selectionEnabled: settings.selectionEnabled, text: "hello" }), "translate");
    }
    const fresh = normalizeSettings({});
    assert.equal(Object.prototype.hasOwnProperty.call(fresh, "selectionMode"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(defaultSettings(), "selectionMode"), false);
    assert.equal(shouldRewriteSettings(fresh), false);
    assert.equal(selectionOffer({ selectionEnabled: false, text: "hello" }), "none");
  });

  it("drops the settings mode control and keeps the home switch copy", () => {
    const html = readFileSync(new URL("../popup/popup.html", import.meta.url), "utf8");
    const { document } = parseHTML(html);
    const home = html.slice(html.indexOf('id="home-view"'), html.indexOf('id="settings-view"'));
    const settings = html.slice(html.indexOf('id="settings-view"'), html.indexOf('id="glossary-view"'));
    assert.match(home, /选中文字后直接翻译/);
    assert.equal(document.querySelector("#home-selection-toggle")?.getAttribute("aria-checked"), "true");
    assert.equal(document.querySelector("#home-view .sub")?.textContent, "整页 AI · v0.1.14");
    assert.equal(home.includes("划词模式"), false);
    assert.equal(home.includes("先确认再翻"), false);
    assert.equal(settings.includes("划词模式"), false);
    assert.equal(settings.includes("先确认再翻"), false);
    assert.equal(settings.includes("划完即翻"), false);
    assert.equal(document.querySelector("#mode-confirm"), null);
    assert.equal(document.querySelector("#mode-immediate"), null);
    assert.equal(settings.includes('id="home-selection-toggle"'), false);
    assert.equal(settings.includes('id="selection-toggle"'), false);
    assert.match(settings, /快捷键 \/ API \/ 厂商 · v0\.1\.14/);
    assert.match(settings, /启用鼠标手势/);
    assert.match(settings, /划词翻译开\/关/);
    assert.match(settings, /源语言/);
    assert.match(home, /允许划选被禁文字/);
    assert.match(home, /术语本/);
    assert.match(home, /截图识译/);
    assert.match(home, /Alt\+E/);
    assert.match(home, /⌞/);

    const popup = readFileSync(new URL("../popup/main.ts", import.meta.url), "utf8");
    assert.equal(popup.includes("selectionMode"), false);
    assert.equal(popup.includes("mode-confirm"), false);
    assert.equal(popup.includes("mode-immediate"), false);
  });

  it("keeps right-click translate on the result float and does not ship a confirm bar", () => {
    assert.equal(menuItems().some((item) => item.id === "translate-selection" && item.title === "翻译选中内容"), true);
    const content = readFileSync(new URL("../content/index.ts", import.meta.url), "utf8");
    assert.equal(content.includes("select-confirm"), false);
    assert.equal(content.includes("selectionMode"), false);
    assert.equal(content.includes("openSelectConfirm"), false);
    assert.equal(content.includes("确认翻译"), false);
    const offer = content.slice(content.indexOf("function offerSelection"), content.indexOf("async function handlePageMessage"));
    assert.match(offer, /selectionOffer\(/);
    assert.match(offer, /openSelectionFloat\(text\)/);
    assert.equal(offer.includes("confirm"), false);
    const handler = content.slice(
      content.indexOf('message.type === "translate-selection"'),
      content.indexOf('message.type === "page-ai-status"'),
    );
    assert.match(handler, /openSelectionFloat\(text\)/);
    assert.equal(handler.includes("selectionEnabled"), false);
    assert.equal(handler.includes("selectionOffer"), false);
    assert.equal(existsSync(new URL("../content/select-confirm.ts", import.meta.url)), false);
    const css = readFileSync(new URL("../content/content.css", import.meta.url), "utf8");
    assert.equal(css.includes("yifan-select-confirm"), false);
    assert.equal(css.includes("confirm-card"), false);
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as {
      version: string;
      description: string;
    };
    assert.equal(manifest.version, "0.1.14");
    assert.match(manifest.description, /选完直接翻译/);
    assert.equal(manifest.description.includes("先确认"), false);
  });
});
