import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { selectionOffer, selectionPreview } from "./selection.ts";
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

describe("selection confirm", () => {
  it("defaults to confirm-before-translate and does not request a translation", () => {
    assert.equal(defaultSettings().selectionMode, "confirm");
    assert.equal(normalizeSettings({}).selectionMode, "confirm");
    assert.equal(normalizeSettings({ selectionMode: "nope" }).selectionMode, "confirm");
    const offer = selectionOffer({
      selectionEnabled: true,
      selectionMode: defaultSettings().selectionMode,
      text: "The plugin keeps the original",
    });
    assert.equal(offer, "confirm");
  });

  it("switches to immediate translate when the setting says so", () => {
    assert.equal(normalizeSettings({ selectionMode: "immediate" }).selectionMode, "immediate");
    assert.equal(
      selectionOffer({ selectionEnabled: true, selectionMode: "immediate", text: "hello" }),
      "translate",
    );
    assert.equal(
      selectionOffer({ selectionEnabled: true, selectionMode: "confirm", text: "hello" }),
      "confirm",
    );
  });

  it("offers nothing when selection translate is off or the selection is empty", () => {
    assert.equal(
      selectionOffer({ selectionEnabled: false, selectionMode: "immediate", text: "hello" }),
      "none",
    );
    assert.equal(
      selectionOffer({ selectionEnabled: true, selectionMode: "confirm", text: "   " }),
      "none",
    );
  });

  it("keeps a single-line preview of the original", () => {
    const preview = selectionPreview("  The plugin keeps\nthe original  ");
    assert.equal(preview, "The plugin keeps the original");
    assert.equal(preview.includes("\n"), false);
  });
});

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
      assert.equal(settings.selectionMode, "confirm");
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
  it("renders three model groups, the confirm-mode control, and no legacy curated options", () => {
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
    assert.equal(document.querySelector("#mode-confirm")?.textContent, "先确认再翻");
    assert.equal(document.querySelector("#mode-confirm")?.getAttribute("aria-pressed"), "true");
    assert.equal(document.querySelector("#mode-immediate")?.textContent, "划完即翻");
    assert.equal(document.querySelector(".sub")?.textContent, "通义千问 · Chrome / Edge 设置");
    assert.match(html, /选中文本弹出确认或浮层（默认开）/);
    assert.match(html, /默认先确认再翻，避免误触耗额度/);
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
    assert.equal(manifest.version, "0.1.3");
    assert.equal(manifest.manifest_version, 3);
    for (const doc of [readme, edge]) {
      assert.match(doc, /0\.1\.3/);
      assert.match(doc, /edge:\/\/extensions/);
      assert.match(doc, /chrome:\/\/extensions/);
      assert.match(doc, /dist\//);
      assert.match(doc, /qwen3\.7-plus/);
    }
    assert.match(edge, /加载解压缩的扩展|Load unpacked/);
    assert.match(readme, /先确认再翻/);
    const undone = readme.split("## 不做")[1] ?? "";
    assert.match(undone, /Firefox/);
    assert.equal(/Edge/.test(undone), false);
  });
});
