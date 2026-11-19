import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDetectionBook, swapDirection } from "./direction.ts";

const zhEn = { sourceLang: "zh", targetLang: "en" };
const autoZh = { sourceLang: "auto", targetLang: "zh" };

describe("swap direction", () => {
  it("swaps a concrete pair twice without calling for English", () => {
    const once = swapDirection({ sourceLang: "zh", targetLang: "en" }, null);
    assert.equal(once.ok, true);
    if (!once.ok) return;
    assert.deepEqual({ sourceLang: once.sourceLang, targetLang: once.targetLang }, { sourceLang: "en", targetLang: "zh" });
    const twice = swapDirection(once, null);
    assert.equal(twice.ok, true);
    if (!twice.ok) return;
    assert.deepEqual({ sourceLang: twice.sourceLang, targetLang: twice.targetLang }, zhEn);
  });

  it("swaps ja to zh into zh to ja", () => {
    const next = swapDirection({ sourceLang: "ja", targetLang: "zh" }, null);
    assert.equal(next.ok, true);
    if (!next.ok) return;
    assert.equal(next.sourceLang, "zh");
    assert.equal(next.targetLang, "ja");
  });

  it("uses a bound code for auto and does not turn zh to zh into English", () => {
    const next = swapDirection(autoZh, "ja");
    assert.equal(next.ok, true);
    if (!next.ok) return;
    assert.equal(next.sourceLang, "zh");
    assert.equal(next.targetLang, "ja");
    const same = swapDirection(autoZh, "zh");
    assert.equal(same.ok, true);
    if (!same.ok) return;
    assert.equal(same.sourceLang, "zh");
    assert.equal(same.targetLang, "zh");
  });

  it("refuses auto without a concrete code and does not guess English", () => {
    const missing = swapDirection(autoZh, null);
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.match(missing.message, /手选源语言/);
    const unknown = swapDirection(autoZh, "unknown");
    assert.equal(unknown.ok, false);
    if (unknown.ok) return;
    assert.match(unknown.message, /未识别出源语言/);
    assert.equal(missing.message.includes("英语"), false);
  });
});

describe("detection binding", () => {
  it("keeps page blocks independent and drops a code after the text or direction changes", () => {
    const book = createDetectionBook();
    const first = book.begin("page", "b1", "今日", autoZh);
    const second = book.begin("page", "b2", "hello", autoZh);
    book.commit(first, "今日", autoZh, "ja", false);
    book.commit(second, "hello", autoZh, null, true);
    assert.equal(book.usableCode(autoZh, "page", "今日"), "ja");
    assert.equal(book.usableCode(autoZh, "page", "hello"), null);
    assert.match(book.hint(autoZh, "page", "hello"), /未识别出源语言/);
    book.invalidateText("page", "b1", "明日");
    assert.equal(book.usableCode(autoZh, "page", "今日"), null);
    book.commit(first, "今日", autoZh, "ja", false);
    book.commit(first, "明日", autoZh, "ja", false);
    assert.equal(book.usableCode(autoZh, "page", "今日"), null);
    assert.equal(book.usableCode(autoZh, "page", "明日"), null);
    book.invalidateDirection({ sourceLang: "zh", targetLang: "ja" });
    assert.equal(book.usableCode(autoZh, "page", "今日"), null);
  });

  it("M7 drops a late commit after the direction has changed", () => {
    const book = createDetectionBook();
    const token = book.begin("input", "input", "hello", autoZh);
    book.invalidateDirection({ sourceLang: "en", targetLang: "zh" });
    book.commit(token, "hello", autoZh, "ja", false);
    assert.equal(book.usableCode(autoZh, "input", "hello"), null);
    assert.equal(book.usableCode({ sourceLang: "en", targetLang: "zh" }, "input", "hello"), null);
  });

  it("M8 does not let a failed second page block borrow the first block code", () => {
    const book = createDetectionBook();
    const first = book.begin("page", "p1", "今日は晴れ", autoZh);
    const second = book.begin("page", "p2", "no header", autoZh);
    book.commit(first, "今日は晴れ", autoZh, "ja", false);
    book.drop(second);
    assert.equal(book.usableCode(autoZh, "page", "今日は晴れ"), "ja");
    assert.equal(book.usableCode(autoZh, "page", "no header"), null);
    assert.equal(book.usableCode(autoZh, "input", "no header"), null);
  });

  it("M10 keeps zh to zh when the detected code equals the target", () => {
    const next = swapDirection(autoZh, "zh");
    assert.equal(next.ok, true);
    if (!next.ok) return;
    assert.equal(next.sourceLang, "zh");
    assert.equal(next.targetLang, "zh");
  });

  it("does not bind a late input result to the edited text or restore the old text", () => {
    const book = createDetectionBook();
    const token = book.begin("input", "input", "TEXT-A", autoZh);
    book.invalidateText("input", "input", "TEXT-B");
    book.commit(token, "TEXT-B", autoZh, "ja", false);
    book.commit(token, "TEXT-A", autoZh, "ja", false);
    assert.equal(book.usableCode(autoZh, "input", "TEXT-B"), null);
    assert.equal(book.usableCode(autoZh, "input", "TEXT-A"), null);
    book.invalidateText("input", "input", "TEXT-A");
    assert.equal(book.usableCode(autoZh, "input", "TEXT-A"), null);
    assert.match(book.hint(autoZh, "input", "TEXT-B"), /原文已更改/);
  });

  it("voids a trim-equivalent edit and does not restore that same text", () => {
    const book = createDetectionBook();
    const token = book.begin("input", "input", "hello", autoZh);
    book.commit(token, "hello", autoZh, "ja", false);
    assert.equal(book.usableCode(autoZh, "input", "hello"), "ja");
    book.invalidateText("input", "input", "hello");
    assert.equal(book.usableCode(autoZh, "input", "hello"), null);
    book.commit(token, "hello", autoZh, "ja", false);
    assert.equal(book.usableCode(autoZh, "input", "hello"), null);
    assert.equal(book.usableCode(autoZh, "input", "hello\n"), null);
  });

  it("does not let a late token revive a newer request", () => {
    const book = createDetectionBook();
    const oldToken = book.begin("input", "input", "hello", autoZh);
    const next = book.begin("input", "input", "hello", autoZh);
    book.commit(oldToken, "hello", autoZh, "fr", false);
    assert.equal(book.usableCode(autoZh, "input", "hello"), null);
    book.commit(next, "hello", autoZh, "ja", false);
    assert.equal(book.usableCode(autoZh, "input", "hello"), "ja");
    book.drop(next);
    assert.equal(book.usableCode(autoZh, "input", "hello"), null);
  });
});
