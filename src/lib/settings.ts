import { normalizeGlossary, type GlossaryEntry } from "./glossary.ts";
import { isSourceLang, isTargetLang } from "./languages.ts";

export const STORAGE_KEY = "yifan.settings.v1";

export const DEFAULT_MODEL = "qwen3.7-plus";

export const MODEL_TIERS = [
  {
    id: "fast",
    label: "快速便宜",
    models: ["qwen3.5-flash", "qwen3.7-flash", "qwen3.8-flash"],
  },
  {
    id: "balanced",
    label: "均衡",
    models: ["qwen3.5-plus", "qwen3.6-plus", "qwen3.7-plus"],
  },
  {
    id: "high",
    label: "能力高",
    models: ["qwen3.7-max", "qwen3.8-max"],
  },
] as const;

export const CURATED_MODELS: readonly string[] = MODEL_TIERS.flatMap((tier) => [...tier.models]);

/** DashScope compatible-mode model id. Legacy ids such as qwen-plus match too. */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const INVALID_MODEL_MESSAGE = "模型 id 无效。请改成百炼的 model id 后再试——不会假翻。";

export type SelectionMode = "confirm" | "immediate";

export interface Settings {
  apiKey: string;
  model: string;
  sourceLang: string;
  targetLang: string;
  selectionEnabled: boolean;
  selectionMode: SelectionMode;
  glossary: GlossaryEntry[];
}

export interface ModelChoice {
  ok: true;
  model: string;
  source: "custom" | "curated";
}

export interface ModelChoiceError {
  ok: false;
  message: string;
}

export function defaultSettings(): Settings {
  return {
    apiKey: "",
    model: DEFAULT_MODEL,
    sourceLang: "auto",
    targetLang: "zh",
    selectionEnabled: true,
    selectionMode: "confirm",
    glossary: [],
  };
}

export function isCuratedModel(value: string): boolean {
  return CURATED_MODELS.includes(value);
}

export function isModelId(value: unknown): value is string {
  return typeof value === "string" && MODEL_ID_PATTERN.test(value);
}

/** Keep any compatible id, including ones saved before the curated list. Malformed values use the default. */
export function normalizeModelId(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_MODEL;
  const trimmed = value.trim();
  if (!isModelId(trimmed)) return DEFAULT_MODEL;
  return trimmed;
}

export function normalizeSelectionMode(value: unknown): SelectionMode {
  return value === "immediate" ? "immediate" : "confirm";
}

/** Custom text wins when it is non-empty. An empty custom field uses the curated select. */
export function resolveModelChoice(selected: string, customRaw: string): ModelChoice | ModelChoiceError {
  const custom = customRaw.trim();
  if (custom) {
    if (!isModelId(custom)) return { ok: false, message: INVALID_MODEL_MESSAGE };
    return { ok: true, model: custom, source: "custom" };
  }
  if (isCuratedModel(selected)) return { ok: true, model: selected, source: "curated" };
  return { ok: true, model: DEFAULT_MODEL, source: "curated" };
}

export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;
  const record = raw as Partial<Settings>;
  return {
    apiKey: typeof record.apiKey === "string" ? record.apiKey.trim() : "",
    model: normalizeModelId(record.model),
    sourceLang: isSourceLang(record.sourceLang) ? record.sourceLang : base.sourceLang,
    targetLang: isTargetLang(record.targetLang) ? record.targetLang : base.targetLang,
    selectionEnabled: typeof record.selectionEnabled === "boolean" ? record.selectionEnabled : true,
    selectionMode: normalizeSelectionMode(record.selectionMode),
    glossary: normalizeGlossary(record.glossary),
  };
}

export function readSettings(): Promise<Settings> {
  return chrome.storage.local.get(STORAGE_KEY).then((bag) => normalizeSettings(bag[STORAGE_KEY]));
}

export function writeSettings(settings: Settings): Promise<void> {
  return chrome.storage.local.set({ [STORAGE_KEY]: normalizeSettings(settings) }).then(() => undefined);
}
