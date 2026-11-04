import { TranslateError, missingKeyError, noTextError } from "./errors.ts";
import { promptName } from "./languages.ts";
import { NO_VISION_OCR_MESSAGE, visionCallModel } from "./providers.ts";
import { completeVision } from "./qwen.ts";
import type { Settings } from "./settings.ts";
import { runTranslationJob } from "./translate-job.ts";

export const CROP_TIP = "拖拽框选要识译的区域";
export const CROP_PRIVACY = "只上传这个选区，用你自己的 Key。不改页面正文。";
export const OCR_PANEL_TITLE = "截图识译";
export const MIN_CROP_PX = 12;
export const MAX_OCR_IMAGE_CHARS = 7_000_000;

export interface CssRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropPixels {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** 把视口里的选区换算成截图像素，并夹在图片范围内。 */
export function cropPixels(
  rect: CssRect,
  image: { width: number; height: number },
  viewport: { width: number; height: number },
): CropPixels | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null;
  if (image.width <= 0 || image.height <= 0) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;
  let sx = Math.round(rect.x * scaleX);
  let sy = Math.round(rect.y * scaleY);
  let sw = Math.round(rect.width * scaleX);
  let sh = Math.round(rect.height * scaleY);
  if (sx < 0) {
    sw += sx;
    sx = 0;
  }
  if (sy < 0) {
    sh += sy;
    sy = 0;
  }
  if (sx + sw > image.width) sw = image.width - sx;
  if (sy + sh > image.height) sh = image.height - sy;
  if (sw < 2 || sh < 2) return null;
  return { sx, sy, sw, sh };
}

export function normalizeRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bounds: { width: number; height: number },
): CssRect {
  const left = clamp(Math.min(x0, x1), 0, bounds.width);
  const top = clamp(Math.min(y0, y1), 0, bounds.height);
  const right = clamp(Math.max(x0, x1), 0, bounds.width);
  const bottom = clamp(Math.max(y0, y1), 0, bounds.height);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function isCropLargeEnough(rect: CssRect, min = MIN_CROP_PX): boolean {
  return rect.width >= min && rect.height >= min;
}

export function isImageDataUrl(value: string): boolean {
  if (value.length < 32 || value.length > MAX_OCR_IMAGE_CHARS) return false;
  return /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
}

/** 只让视觉模型抄字。翻译交给文本模型和术语本，避免两套译法。 */
export function buildOcrPrompt(): string {
  return [
    "请只抄写图片里能看清的文字。",
    "保留原有换行。不要翻译，不要解释，不要补写图片里没有的句子。",
    "如果没有可辨认的文字，只输出：无文字",
  ].join("\n");
}

export function parseOcrText(raw: string): { ok: true; text: string } | { ok: false; reason: "empty" | "no_text" } {
  const text = raw
    .replace(/^\uFEFF/, "")
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!text) return { ok: false, reason: "empty" };
  if (/^无文字[。．.]?$/.test(text)) return { ok: false, reason: "no_text" };
  return { ok: true, text };
}

/** 字已经识出来，但译文这一步失败。面板可以展示原文，不能编译文。 */
export class OcrTranslateError extends TranslateError {
  readonly source: string;

  constructor(source: string, cause: TranslateError) {
    super(cause.code, "识译失败", cause.message, cause.fatal);
    this.name = "OcrTranslateError";
    this.source = source;
  }
}

export async function recognizeAndTranslate(opts: {
  imageDataUrl: string;
  settings: Settings;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<{ source: string; translation: string }> {
  if (!isImageDataUrl(opts.imageDataUrl)) {
    throw new TranslateError("unknown", "识译失败", "选区图片太大或无效。没有改动页面。不会假翻。", true);
  }
  const model = visionCallModel(opts.settings);
  if (!model) {
    throw new TranslateError(
      "unknown",
      "识译失败",
      `${NO_VISION_OCR_MESSAGE}。不会假翻。页面正文没有改动。`,
      true,
    );
  }
  if (!opts.settings.apiKey.trim()) throw missingKeyError("ocr");
  const recognized = await completeVision({
    apiKey: opts.settings.apiKey.trim(),
    model,
    provider: opts.settings.provider,
    prompt: buildOcrPrompt(),
    imageDataUrl: opts.imageDataUrl,
    signal: opts.signal,
    fetchImpl: opts.fetchImpl,
  });
  const parsed = parseOcrText(recognized);
  if (!parsed.ok) throw noTextError();
  let translation = "";
  try {
    await runTranslationJob({
      text: parsed.text,
      settings: opts.settings,
      signal: opts.signal,
      fetchImpl: opts.fetchImpl,
      onText: (text) => {
        translation = text;
      },
    });
  } catch (error) {
    if (error instanceof TranslateError) throw new OcrTranslateError(parsed.text, error);
    throw error;
  }
  const finalText = translation.trim();
  if (!finalText) throw new TranslateError("empty", "识译失败", "没有得到译文。不会假翻。", true);
  return { source: parsed.text, translation: finalText };
}

export function ocrTargetLabel(targetLang: string): string {
  return promptName(targetLang);
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
