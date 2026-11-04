import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { TranslateError } from "./errors.ts";
import { menuItems } from "./menu.ts";
import {
  CROP_PRIVACY,
  CROP_TIP,
  MAX_OCR_IMAGE_CHARS,
  OcrTranslateError,
  buildOcrPrompt,
  cropPixels,
  isCropLargeEnough,
  isImageDataUrl,
  normalizeRect,
  parseOcrText,
  recognizeAndTranslate,
} from "./ocr.ts";
import { buildVisionBody, completionText } from "./qwen.ts";
import { DEFAULT_VISION_MODEL, defaultSettings, normalizeSettings } from "./settings.ts";

const image = `data:image/jpeg;base64,${"abc".repeat(30)}`;

function sseOf(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
}

function jsonOf(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

describe("crop geometry", () => {
  it("maps css pixels through device scale and clamps to the image", () => {
    const pixels = cropPixels(
      { x: 10, y: 20, width: 100, height: 50 },
      { width: 1600, height: 1200 },
      { width: 800, height: 600 },
    );
    assert.deepEqual(pixels, { sx: 20, sy: 40, sw: 200, sh: 100 });

    const clamped = cropPixels(
      { x: -8, y: 10, width: 40, height: 20 },
      { width: 100, height: 80 },
      { width: 100, height: 80 },
    );
    assert.deepEqual(clamped, { sx: 0, sy: 10, sw: 32, sh: 20 });
    assert.equal(cropPixels({ x: 0, y: 0, width: 1, height: 1 }, { width: 10, height: 10 }, { width: 0, height: 10 }), null);
  });

  it("normalizes a drag into the viewport and ignores a tiny box", () => {
    assert.deepEqual(normalizeRect(80, 40, 20, 90, { width: 200, height: 100 }), {
      x: 20,
      y: 40,
      width: 60,
      height: 50,
    });
    assert.deepEqual(normalizeRect(-10, -10, 500, 500, { width: 320, height: 180 }), {
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    });
    assert.equal(isCropLargeEnough({ x: 0, y: 0, width: 11, height: 40 }), false);
    assert.equal(isCropLargeEnough({ x: 0, y: 0, width: 12, height: 12 }), true);
  });
});

describe("ocr text", () => {
  it("keeps the picture text and treats an empty read as no text", () => {
    const spaced = parseOcrText("  Hello\nworld  ");
    assert.equal(spaced.ok && spaced.text, "Hello\nworld");
    const fenced = parseOcrText("```\nLine one\n```");
    assert.equal(fenced.ok && fenced.text, "Line one");
    assert.deepEqual(parseOcrText("无文字"), { ok: false, reason: "no_text" });
    assert.deepEqual(parseOcrText("无文字。"), { ok: false, reason: "no_text" });
    assert.deepEqual(parseOcrText("   "), { ok: false, reason: "empty" });
    assert.match(buildOcrPrompt(), /不要翻译/);
    assert.match(CROP_TIP, /框选/);
    assert.match(CROP_PRIVACY, /不改页面正文/);
  });

  it("builds a non-streaming vision body and reads string or array content", () => {
    const body = buildVisionBody({ model: DEFAULT_VISION_MODEL, prompt: "抄写", imageDataUrl: image });
    assert.equal(body.model, "qwen3-vl-plus");
    assert.equal(body.stream, false);
    assert.equal(body.enable_thinking, false);
    const content = (body.messages as Array<{ content: Array<{ type: string }> }>)[0]?.content ?? [];
    assert.deepEqual(content.map((part) => part.type), ["text", "image_url"]);
    assert.equal(completionText({ choices: [{ message: { content: "原文" } }] }), "原文");
    assert.equal(
      completionText({ choices: [{ message: { content: [{ type: "text", text: "甲" }, { type: "text", text: "乙" }] } }] }),
      "甲乙",
    );
    assert.equal(isImageDataUrl(image), true);
    assert.equal(isImageDataUrl("https://example.com/a.png"), false);
    assert.equal(isImageDataUrl(`${image}${"a".repeat(MAX_OCR_IMAGE_CHARS)}`), false);
  });
});

describe("recognize and translate", () => {
  it("uses the vision model to read, then the text model to translate", async () => {
    const settings = defaultSettings();
    settings.apiKey = "sk-test-key";
    settings.model = "qwen3.7-plus";
    settings.targetLang = "zh";
    const models: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string; stream: boolean };
      models.push(body.model);
      if (models.length === 1) {
        assert.equal(body.stream, false);
        return new Response(jsonOf("Hello image"), { status: 200 });
      }
      return new Response(sseOf("你好，图片"), { status: 200 });
    };
    const result = await recognizeAndTranslate({
      imageDataUrl: image,
      settings,
      signal: new AbortController().signal,
      fetchImpl,
    });
    assert.deepEqual(models, ["qwen3-vl-plus", "qwen3.7-plus"]);
    assert.equal(result.source, "Hello image");
    assert.equal(result.translation, "你好，图片");
  });

  it("does not invent a translation when there is no key, no text, or the vision call fails", async () => {
    const settings = defaultSettings();
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(jsonOf("应该不会被用到"), { status: 200 });
    };
    await assert.rejects(
      () => recognizeAndTranslate({
        imageDataUrl: image,
        settings,
        signal: new AbortController().signal,
        fetchImpl,
      }),
      (error: unknown) => {
        assert.ok(error instanceof TranslateError);
        assert.match(error.message, /API Key/);
        assert.match(error.message, /不会假翻/);
        return true;
      },
    );
    assert.equal(calls, 0);

    settings.apiKey = "sk-test-key";
    calls = 0;
    const noTextFetch: typeof fetch = async () => {
      calls += 1;
      return new Response(jsonOf("无文字"), { status: 200 });
    };
    await assert.rejects(
      () => recognizeAndTranslate({
        imageDataUrl: image,
        settings,
        signal: new AbortController().signal,
        fetchImpl: noTextFetch,
      }),
      (error: unknown) => {
        assert.ok(error instanceof TranslateError);
        assert.match(error.message, /没有识别出文字/);
        assert.match(error.message, /不会假翻/);
        return true;
      },
    );
    assert.equal(calls, 1);

    const denied: typeof fetch = async () => new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 });
    await assert.rejects(
      () => recognizeAndTranslate({
        imageDataUrl: image,
        settings,
        signal: new AbortController().signal,
        fetchImpl: denied,
      }),
      (error: unknown) => {
        assert.ok(error instanceof TranslateError);
        assert.equal(error instanceof OcrTranslateError, false);
        assert.match(error.message, /不会假翻/);
        assert.equal(error.message.includes("应该不会"), false);
        return true;
      },
    );
  });

  it("keeps the recognized text when translation fails and does not replace it with a guess", async () => {
    const settings = defaultSettings();
    settings.apiKey = "sk-test-key";
    let step = 0;
    const fetchImpl: typeof fetch = async () => {
      step += 1;
      if (step === 1) return new Response(jsonOf("Visible sentence"), { status: 200 });
      return new Response("upstream down", { status: 503 });
    };
    await assert.rejects(
      () => recognizeAndTranslate({
        imageDataUrl: image,
        settings,
        signal: new AbortController().signal,
        fetchImpl,
      }),
      (error: unknown) => {
        assert.ok(error instanceof OcrTranslateError);
        assert.equal(error.source, "Visible sentence");
        assert.match(error.message, /不会假翻/);
        assert.equal(error.message.includes("Visible sentence"), false);
        return true;
      },
    );
  });

  it("defaults the vision model separately from the text model", () => {
    assert.equal(defaultSettings().visionModel, "qwen3-vl-plus");
    assert.equal(defaultSettings().model, "qwen3.7-plus");
    assert.equal(normalizeSettings({}).visionModel, DEFAULT_VISION_MODEL);
    assert.equal(normalizeSettings({ visionModel: "qwen-vl-max" }).visionModel, "qwen-vl-max");
    assert.equal(normalizeSettings({ visionModel: "bad model", model: "qwen3.7-plus" }).visionModel, DEFAULT_VISION_MODEL);
    assert.equal(normalizeSettings({ model: "qwen3-vl-plus" }).model, "qwen3-vl-plus");
    assert.equal(normalizeSettings({ model: "qwen3-vl-plus" }).visionModel, DEFAULT_VISION_MODEL);
  });
});

describe("v0.1.8 surfaces", () => {
  it("puts shortcuts and screenshot entry on the home popup, and keeps key and model in settings", () => {
    const html = readFileSync(new URL("../popup/popup.html", import.meta.url), "utf8");
    const { document } = parseHTML(html);
    const home = document.querySelector("#home-view");
    assert.ok(home);
    assert.equal(home.querySelector("#api-key"), null);
    assert.equal(home.querySelector("#model"), null);
    assert.equal(home.querySelector("#custom-model"), null);
    assert.equal(home.querySelector("#home-source-lang"), null);
    assert.equal(home.querySelector("#home-target-lang"), null);
    assert.equal(home.querySelector("#home-mode-confirm"), null);
    assert.equal(home.querySelector("#home-selection-toggle")?.getAttribute("aria-checked"), "true");
    assert.equal(home.querySelector("#home-force-select")?.getAttribute("aria-checked"), "false");
    assert.match(home.querySelector("#home-open-glossary")?.textContent ?? "", /术语本/);
    assert.match(home.querySelector("#screenshot-ocr")?.textContent ?? "", /截图识译/);
    assert.match(home.querySelector("#hotkey-tip")?.textContent ?? "", /Alt\+T/);
    assert.match(home.querySelector("#hotkey-tip")?.textContent ?? "", /Alt\+S/);
    assert.match(home.querySelector("#hotkey-tip")?.textContent ?? "", /⌝/);
    assert.equal(document.querySelector("#settings-view #source-lang")?.getAttribute("aria-label"), "源语言");
    assert.equal(document.querySelector("#settings-view #mode-confirm")?.textContent, "先确认再翻");
    assert.equal(document.querySelector("#settings-view #gesture-toggle")?.getAttribute("aria-checked"), "true");
    assert.equal(document.querySelector("#settings-view #api-key")?.getAttribute("type"), "password");
    assert.equal(document.querySelector("#settings-view #model option[selected]")?.getAttribute("value"), "qwen3.7-plus");
    assert.equal(menuItems().some((item) => item.title === "框选识译…"), true);

    const popup = readFileSync(new URL("../popup/main.ts", import.meta.url), "utf8");
    assert.match(popup, /patchSettings/);
    assert.match(popup, /start-crop-ocr/);

    const crop = readFileSync(new URL("../content/crop.ts", import.meta.url), "utf8");
    const index = readFileSync(new URL("../content/index.ts", import.meta.url), "utf8");
    const background = readFileSync(new URL("../background/index.ts", import.meta.url), "utf8");
    assert.equal(crop.includes("replaceInPlace"), false);
    assert.equal(crop.includes("data-yifan-replaced"), false);
    assert.match(crop, /capture-visible/);
    assert.match(crop, /复制原文/);
    assert.match(crop, /复制译文/);
    assert.match(background, /captureVisibleTab/);
    assert.match(background, /recognizeAndTranslate/);
    const escape = index.slice(index.indexOf('event.key === "Escape"'), index.indexOf("function offerSelection"));
    assert.ok(escape.indexOf("dismissOcrUi") >= 0);
    assert.ok(escape.indexOf("dismissOcrUi") < escape.indexOf("clearInlinePage"));
    assert.match(index, /isOcrUiActive\(\)/);
  });
});
