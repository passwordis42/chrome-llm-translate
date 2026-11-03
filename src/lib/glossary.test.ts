import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyGlossary, presentTranslation, restoreGlossary } from "./glossary.ts";

const entries = [
  { id: "1", source: "large language model", target: "大语言模型" },
  { id: "2", source: "side by side", target: "并排对照" },
  { id: "3", source: "floating card", target: "浮层卡片" },
];

describe("glossary", () => {
  it("replaces longer terms first and restores fixed translations", () => {
    const applied = applyGlossary(
      "The large language model keeps them side by side in a floating card.",
      entries,
    );
    assert.equal(applied.text.includes("large language model"), false);
    assert.equal(applied.text.includes("side by side"), false);
    assert.equal(applied.text.includes("floating card"), false);
    assert.match(applied.text, /\[\[YF\d+\]\]/);
    const restored = restoreGlossary(applied.text, applied.tokens);
    assert.equal(
      restored,
      "The 大语言模型 keeps them 并排对照 in a 浮层卡片.",
    );
  });

  it("does not let a shorter term eat a longer one", () => {
    const applied = applyGlossary("large language model", [
      { id: "a", source: "language", target: "WRONG" },
      { id: "b", source: "large language model", target: "大语言模型" },
    ]);
    assert.equal(restoreGlossary(applied.text, applied.tokens), "大语言模型");
    assert.equal(applied.text.includes("WRONG"), false);
  });

  it("matches latin terms on word boundaries and ignores case", () => {
    const applied = applyGlossary("The API Key opens the keyboard.", [
      { id: "k", source: "key", target: "密钥" },
      { id: "a", source: "API key", target: "接口密钥" },
    ]);
    const restored = restoreGlossary(applied.text, applied.tokens);
    assert.equal(restored, "The 接口密钥 opens the keyboard.");
  });

  it("matches a CJK term inside a sentence", () => {
    const applied = applyGlossary("请保留浮层卡片。", [
      { id: "c", source: "浮层卡片", target: "floating card" },
    ]);
    assert.equal(restoreGlossary(applied.text, applied.tokens), "请保留floating card。");
  });

  it("hides a trailing partial token while streaming", () => {
    const tokens = [{ token: "[[YF0]]", source: "side by side", target: "并排对照" }];
    assert.equal(presentTranslation("并排开始 [[YF", tokens, false), "并排开始 ");
    assert.equal(presentTranslation("见 [[YF0]]。", tokens, false), "见 并排对照。");
  });

  it("leaves text alone when the glossary is empty", () => {
    const applied = applyGlossary("leave me", []);
    assert.equal(applied.text, "leave me");
    assert.deepEqual(applied.tokens, []);
  });
});
