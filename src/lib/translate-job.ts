import { missingKeyError, TranslateError, emptyCompletionError, protocolTranslateError, tooLongError } from "./errors.ts";
import { applyGlossary, presentTranslation } from "./glossary.ts";
import { isSourceLang, isTargetLang } from "./languages.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { streamChat } from "./qwen.ts";
import { MAX_SELECTION_CHARS } from "./selection.ts";
import type { Settings } from "./settings.ts";
import { createYf1Parser, protocolModeForSource, type Yf1Result } from "./yf1.ts";

export interface TranslationDetection {
  outcome: Yf1Result["outcome"];
  code: string | null;
}

export async function runTranslationJob(opts: {
  text: string;
  settings: Settings;
  sourceLang?: string;
  targetLang?: string;
  signal: AbortSignal;
  onText: (restored: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<TranslationDetection> {
  const text = opts.text.trim();
  if (!text) throw emptyCompletionError("float");
  if (text.length > MAX_SELECTION_CHARS) throw tooLongError();
  if (!opts.settings.apiKey.trim()) throw missingKeyError("float");

  const sourceLang = isSourceLang(opts.sourceLang) ? opts.sourceLang : opts.settings.sourceLang;
  const targetLang = isTargetLang(opts.targetLang) ? opts.targetLang : opts.settings.targetLang;
  const mode = protocolModeForSource(sourceLang);
  const parser = createYf1Parser(mode);
  const protectedText = applyGlossary(text, opts.settings.glossary);
  const system = buildSystemPrompt({
    sourceLang,
    targetLang,
    tokens: protectedText.tokens,
  });

  let raw = "";
  let shown = "";
  const emit = (piece: string, final: boolean) => {
    if (!piece && !final) return;
    raw += piece;
    const next = presentTranslation(raw, protectedText.tokens, final);
    if (next !== shown && (next || final)) {
      shown = next;
      if (next) opts.onText(next);
    }
  };
  try {
    await streamChat({
      apiKey: opts.settings.apiKey.trim(),
      model: opts.settings.model,
      provider: opts.settings.provider,
      system,
      user: protectedText.text,
      signal: opts.signal,
      fetchImpl: opts.fetchImpl,
      where: "float",
      onDelta: (chunk) => {
        emit(parser.push(chunk), false);
      },
    });
  } catch (error) {
    parser.finish("abort");
    throw error;
  }

  const parsed = parser.finish(opts.signal.aborted ? "abort" : "complete");
  if (parsed.outcome === "protocol-error") throw protocolTranslateError("float");
  if (parsed.outcome === "incomplete") {
    const error = new DOMException("aborted", "AbortError");
    throw error;
  }
  const finalText = presentTranslation(parsed.text, protectedText.tokens, true).trim();
  if (!finalText && parsed.outcome !== "code" && parsed.outcome !== "unknown") throw emptyCompletionError("float");
  if (finalText && finalText !== shown) opts.onText(finalText);
  return {
    outcome: parsed.outcome,
    code: parsed.outcome === "code" ? parsed.code : null,
  };
}

export function isFatalTranslateError(error: unknown): boolean {
  return error instanceof TranslateError && error.fatal;
}
