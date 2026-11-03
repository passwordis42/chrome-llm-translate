import { missingKeyError, TranslateError, emptyCompletionError, tooLongError } from "./errors.ts";
import { applyGlossary, presentTranslation } from "./glossary.ts";
import { isSourceLang, isTargetLang } from "./languages.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { streamChat } from "./qwen.ts";
import { MAX_SELECTION_CHARS } from "./selection.ts";
import type { Settings } from "./settings.ts";

export async function runTranslationJob(opts: {
  text: string;
  settings: Settings;
  sourceLang?: string;
  targetLang?: string;
  signal: AbortSignal;
  onText: (restored: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const text = opts.text.trim();
  if (!text) throw emptyCompletionError("float");
  if (text.length > MAX_SELECTION_CHARS) throw tooLongError();
  if (!opts.settings.apiKey.trim()) throw missingKeyError("float");

  const sourceLang = isSourceLang(opts.sourceLang) ? opts.sourceLang : opts.settings.sourceLang;
  const targetLang = isTargetLang(opts.targetLang) ? opts.targetLang : opts.settings.targetLang;
  const protectedText = applyGlossary(text, opts.settings.glossary);
  const system = buildSystemPrompt({
    sourceLang,
    targetLang,
    tokens: protectedText.tokens,
  });

  let raw = "";
  let shown = "";
  await streamChat({
    apiKey: opts.settings.apiKey.trim(),
    model: opts.settings.model,
    system,
    user: protectedText.text,
    signal: opts.signal,
    fetchImpl: opts.fetchImpl,
    where: "float",
    onDelta: (chunk) => {
      raw += chunk;
      const next = presentTranslation(raw, protectedText.tokens, false);
      if (next && next !== shown) {
        shown = next;
        opts.onText(next);
      }
    },
  });

  const finalText = presentTranslation(raw, protectedText.tokens, true).trim();
  if (!finalText) throw emptyCompletionError("float");
  if (finalText !== shown) opts.onText(finalText);
}

export function isFatalTranslateError(error: unknown): boolean {
  return error instanceof TranslateError && error.fatal;
}
