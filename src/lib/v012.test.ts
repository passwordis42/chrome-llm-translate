import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import {
  CURATED_MODELS,
  DEFAULT_MODEL,
  MODEL_TIERS,
  defaultSettings,
  isCuratedModel,
  normalizeSettings,
  resolveModelChoice,
} from "./settings.ts";

const LEGACY_MODELS = ["qwen-turbo", "qwen-plus", "qwen-max"];

describe("model tiers", () => {
  it("defaults to qwen3.7-plus and lists the curated tiers", () => {
    assert.equal(DEFAULT_MODEL, "qwen3.7-plus");
    assert.equal(defaultSettings().model, "qwen3.7-plus");
    assert.equal(normalizeSettings({}).model, "qwen3.7-plus");
    assert.deepEqual(
      MODEL_TIERS.map((tier) => [tier.label, ...tier.models]),
      [
        ["快速便宜", "qwen3.5-flash", "qwen3.7-flash", "qwen3.8-flash"],
        ["均衡", "qwen3.5-plus", "qwen3.6-plus", "qwen3.7-plus"],
        ["能力高", "qwen3.7-max", "qwen3.8-max"],
      ],
    );
    assert.equal(isCuratedModel("qwen3.7-plus"), true);
    for (const legacy of LEGACY_MODELS) {
      assert.equal(CURATED_MODELS.includes(legacy), false);
    }
  });

  it("keeps a previously saved legacy or custom model id", () => {
    for (const legacy of LEGACY_MODELS) {
      const settings = normalizeSettings({
        apiKey: " sk-legacy ",
        model: `  ${legacy}  `,
        sourceLang: "en",
        targetLang: "zh",
        selectionEnabled: true,
        glossary: [{ id: "1", source: "API", target: "接口" }],
      });
      assert.equal(settings.model, legacy);
      assert.equal(settings.apiKey, "sk-legacy");
      assert.equal("selectionMode" in settings, false);
      assert.equal(settings.glossary.length, 1);
    }
    assert.equal(normalizeSettings({ model: "qwen2.5-72b-instruct" }).model, "qwen2.5-72b-instruct");
  });

  it("rejects a malformed id and lets a typed custom id override the curated select", () => {
    assert.equal(normalizeSettings({ model: "not a model" }).model, "qwen3.7-plus");
    assert.equal(normalizeSettings({ model: "" }).model, "qwen3.7-plus");
    assert.deepEqual(resolveModelChoice("qwen3.5-flash", ""), {
      ok: true,
      model: "qwen3.5-flash",
      source: "curated",
    });
    assert.deepEqual(resolveModelChoice("qwen3.7-plus", "  qwen-plus  "), {
      ok: true,
      model: "qwen-plus",
      source: "custom",
    });
    const invalid = resolveModelChoice("qwen3.7-plus", "bad model");
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.match(invalid.message, /不会假翻/);
  });
});

describe("settings ui and edge notes", () => {
  it("renders three model groups and no legacy curated options", () => {
    const html = readFileSync(new URL("../popup/popup.html", import.meta.url), "utf8");
    const { document } = parseHTML(html);
    const groups = [...document.querySelectorAll("#model optgroup")].map((group) => ({
      label: group.getAttribute("label"),
      models: [...group.querySelectorAll("option")].map((option) => option.getAttribute("value")),
    }));
    assert.deepEqual(
      groups,
      MODEL_TIERS.map((tier) => ({ label: tier.label, models: [...tier.models] })),
    );
    const selected = document.querySelector<HTMLOptionElement>("#model option[selected]");
    assert.equal(selected?.value, "qwen3.7-plus");
    assert.equal(document.querySelector("#custom-model")?.getAttribute("placeholder"), "例如 qwen-plus（留空则用上方精选）");
    assert.equal(document.querySelector("#mode-confirm"), null);
    assert.equal(document.querySelector("#mode-immediate"), null);
    assert.equal(document.querySelector("#settings-view .sub")?.textContent, "快捷键 / API / 厂商 · v0.1.14");
    const home = document.querySelector("#home-view");
    assert.equal(home?.querySelector("#api-key"), null);
    assert.equal(home?.querySelector("#model"), null);
    assert.equal(home?.querySelector("#start-page")?.textContent, "开始");
    assert.equal(home?.querySelector("#stop-page")?.textContent, "停止");
    assert.equal(home?.querySelector("#clear-page")?.textContent, "清除");
    assert.equal(home?.querySelector(".sub")?.textContent, "整页 AI · v0.1.14");
    assert.equal(document.querySelector("#back-home")?.getAttribute("aria-label"), "返回主弹窗");
    assert.equal(document.querySelector("#settings-view h1")?.textContent, "设置");
    assert.match(html, /选中文字后直接翻译/);
    assert.equal(html.includes("选中文本弹出确认或浮层"), false);
    assert.equal(html.includes("划词模式"), false);
    assert.equal(html.includes("先确认再翻"), false);
    assert.equal(html.includes("划完即翻"), false);
    for (const legacy of LEGACY_MODELS) {
      assert.equal(document.querySelector(`#model option[value="${legacy}"]`), null);
    }
  });

  it("documents the same MV3 package for Chrome and Edge", () => {
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    const edge = readFileSync(new URL("../../EDGE.md", import.meta.url), "utf8");
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as {
      version: string;
      manifest_version: number;
    };
    assert.equal(manifest.version, "0.1.14");
    assert.equal(manifest.manifest_version, 3);
    for (const doc of [readme, edge]) {
      assert.match(doc, /0\.1\.14/);
      assert.match(doc, /edge:\/\/extensions/);
      assert.match(doc, /chrome:\/\/extensions/);
      assert.match(doc, /dist\//);
      assert.match(doc, /qwen3\.7-plus/);
    }
    assert.match(edge, /加载解压缩的扩展|Load unpacked/);
    assert.match(readme, /选完直接翻译/);
    assert.equal(readme.includes("划词模式"), false);
    const undone = readme.split("## 不做")[1] ?? "";
    assert.match(undone, /Firefox/);
    assert.equal(/Edge/.test(undone), false);
  });
});
