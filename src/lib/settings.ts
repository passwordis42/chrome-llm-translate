import { normalizeGlossary, type GlossaryEntry } from "./glossary.ts";
import { isSourceLang, isTargetLang } from "./languages.ts";

export const STORAGE_KEY = "yifan.settings.v1";

export const MODELS = ["qwen-plus", "qwen-turbo", "qwen-max"] as const;
export type ModelId = (typeof MODELS)[number];

export interface Settings {
  apiKey: string;
  model: ModelId;
  sourceLang: string;
  targetLang: string;
  selectionEnabled: boolean;
  glossary: GlossaryEntry[];
}

export function defaultSettings(): Settings {
  return {
    apiKey: "",
    model: "qwen-plus",
    sourceLang: "auto",
    targetLang: "zh",
    selectionEnabled: true,
    glossary: [],
  };
}

export function isModel(value: unknown): value is ModelId {
  return typeof value === "string" && (MODELS as readonly string[]).includes(value);
}

export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;
  const record = raw as Partial<Settings>;
  return {
    apiKey: typeof record.apiKey === "string" ? record.apiKey.trim() : "",
    model: isModel(record.model) ? record.model : base.model,
    sourceLang: isSourceLang(record.sourceLang) ? record.sourceLang : base.sourceLang,
    targetLang: isTargetLang(record.targetLang) ? record.targetLang : base.targetLang,
    selectionEnabled: typeof record.selectionEnabled === "boolean" ? record.selectionEnabled : true,
    glossary: normalizeGlossary(record.glossary),
  };
}

export function readSettings(): Promise<Settings> {
  return chrome.storage.local.get(STORAGE_KEY).then((bag) => normalizeSettings(bag[STORAGE_KEY]));
}

export function writeSettings(settings: Settings): Promise<void> {
  return chrome.storage.local.set({ [STORAGE_KEY]: normalizeSettings(settings) }).then(() => undefined);
}
