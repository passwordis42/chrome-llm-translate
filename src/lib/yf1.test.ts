import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { YF1_HEADER_LIMIT, createYf1Parser, protocolModeForSource } from "./yf1.ts";

function run(mode: "strict-auto" | "plain-specific" | "legacy-explicit", chunks: string[], reason: "complete" | "abort" = "complete") {
  const parser = createYf1Parser(mode);
  let shown = "";
  for (const chunk of chunks) shown += parser.push(chunk);
  const result = parser.finish(reason);
  return { shown, result };
}

describe("YF1 strict auto protocol", () => {
  it("M1 joins a header split across chunks and strips it once", () => {
    const { shown, result } = run("strict-auto", ["YF1 ja", "\n译文"]);
    assert.equal(shown, "译文");
    assert.equal(result.text, "译文");
    assert.equal(result.outcome, "code");
    assert.equal(result.code, "ja");
    assert.equal(shown.includes("YF1"), false);
  });

  it("M2 keeps a French code instead of guessing English from Latin text", () => {
    const { shown, result } = run("strict-auto", ["YF1 fr\nLes modèles restent en français."]);
    assert.equal(result.code, "fr");
    assert.notEqual(result.code, "en");
    assert.equal(shown.startsWith("Les"), true);
    assert.equal(shown.includes("YF1"), false);
  });

  it("M3 rejects a headerless auto response and does not leak it", () => {
    const { shown, result } = run("strict-auto", ["你好世界"]);
    assert.equal(result.outcome, "protocol-error");
    assert.equal(result.text, "");
    assert.equal(shown, "");
    assert.equal(result.code, null);
  });

  it("M3L shows a headerless body only in explicit legacy mode", () => {
    const { shown, result } = run("legacy-explicit", ["你好世界"]);
    assert.equal(result.outcome, "legacy");
    assert.equal(shown, "你好世界");
    assert.equal(result.code, null);
  });

  it("M4 rejects an illegal code and does not pass the following body through", () => {
    const { shown, result } = run("strict-auto", ["YF1 xx\n译文"]);
    assert.equal(result.outcome, "protocol-error");
    assert.equal(shown, "");
    assert.equal(result.text, "");
  });

  it("M5 treats a truncated header as a protocol error", () => {
    const { shown, result } = run("strict-auto", ["YF1 "]);
    assert.equal(result.outcome, "protocol-error");
    assert.equal(shown, "");
    assert.equal(result.text.includes("YF1"), false);
  });

  it("M6 drops a cancelled header and does not emit it", () => {
    const { shown, result } = run("strict-auto", ["YF"], "abort");
    assert.equal(shown, "");
    assert.equal(result.outcome, "protocol-error");
    assert.equal(result.code, null);
  });

  it("M12 strips only the first legal header and keeps a later YF1 line", () => {
    const { shown, result } = run("strict-auto", ["YF1 ja\nYF1 en\n仍是正文"]);
    assert.equal(result.code, "ja");
    assert.equal(shown, "YF1 en\n仍是正文");
  });

  it("M13 fails closed when the header buffer reaches 16 characters without a newline", () => {
    const chunk = "YF1 ja-and-more!!";
    assert.equal(chunk.length >= YF1_HEADER_LIMIT, true);
    assert.equal(chunk.includes("\n"), false);
    const { shown, result } = run("strict-auto", [chunk]);
    assert.equal(result.outcome, "protocol-error");
    assert.equal(shown, "");
  });

  it("M14 accepts an empty body after a complete header", () => {
    const { shown, result } = run("strict-auto", ["YF1 ja\n"]);
    assert.equal(result.outcome, "code");
    assert.equal(result.code, "ja");
    assert.equal(shown, "");
    assert.equal(result.text, "");
  });

  it("M15 accepts CRLF as the header terminator", () => {
    const { shown, result } = run("strict-auto", ["YF1 ja\r\n译文"]);
    assert.equal(result.code, "ja");
    assert.equal(shown, "译文");
    assert.equal(shown.includes("\r"), false);
  });

  it("M16 does not treat a bare CR as the terminator", () => {
    const { shown, result } = run("strict-auto", ["YF1 ja\r"]);
    assert.equal(result.outcome, "protocol-error");
    assert.equal(shown, "");
  });

  it("M17 shows the body for unknown and does not yield a swappable code", () => {
    const { shown, result } = run("strict-auto", ["YF1 unknown\n只有译文"]);
    assert.equal(result.outcome, "unknown");
    assert.equal(result.code, null);
    assert.equal(shown, "只有译文");
  });

  it("M18 keeps a partial body but does not publish the code when the stream is aborted", () => {
    const { shown, result } = run("strict-auto", ["YF1 ja\n部分"], "abort");
    assert.equal(shown, "部分");
    assert.equal(result.outcome, "incomplete");
    assert.equal(result.code, null);
    assert.equal(result.text, "部分");
  });

  it("rejects auto, blank, and spaced variants", () => {
    for (const sample of ["YF1 auto\n译文", "YF1  ja\n译文", "YF1 ja \n译文", "yf1 ja\n译文", "\n译文"]) {
      const { shown, result } = run("strict-auto", [sample]);
      assert.equal(result.outcome, "protocol-error", sample);
      assert.equal(shown, "");
    }
  });

  it("M9 and M11 leave a specific-source body untouched, including a YF1 prefix", () => {
    assert.equal(protocolModeForSource("ja"), "plain-specific");
    assert.equal(protocolModeForSource("auto"), "strict-auto");
    assert.equal(protocolModeForSource("auto"), "strict-auto");
    const prefixed = run("plain-specific", ["YF1 en\n用户正文以协议样开头"]);
    assert.equal(prefixed.result.outcome, "plain");
    assert.equal(prefixed.result.code, null);
    assert.equal(prefixed.shown, "YF1 en\n用户正文以协议样开头");
    const embedded = run("plain-specific", ["YF1 ja\n仍是用户正文"]);
    assert.equal(embedded.shown, "YF1 ja\n仍是用户正文");
    assert.equal(embedded.result.code, null);
  });
});
