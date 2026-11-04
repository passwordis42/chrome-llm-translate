import { normalizeGlossary, type GlossaryEntry } from "./glossary.ts";
import { isSourceLang, isTargetLang } from "./languages.ts";
import {
  DEFAULT_MODEL,
  DEFAULT_VISION_MODEL,
  MODEL_TIERS,
  CURATED_MODELS,
  PROVIDERS,
  isProviderCurated,
  isProviderId,
  type ProviderId,
} from "./providers.ts";

export { CURATED_MODELS, DEFAULT_MODEL, DEFAULT_VISION_MODEL, MODEL_TIERS };

export const STORAGE_KEY = "yifan.settings.v1";

/** DashScope compatible-mode model id. Legacy ids such as qwen-plus match too. 火山 ep- 也走这条。 */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const INVALID_MODEL_MESSAGE = "模型 id 无效。请改成百炼的 model id 后再试——不会假翻。";

export type SelectionMode = "confirm" | "immediate";

export interface ProviderSlot {
  apiKey: string;
  model: string;
  /** 只有千问会用。别的厂商写成空字符串。 */
  visionModel: string;
}

export interface Settings {
  /** 当前厂商。旧数据没有这个字段时，迁移后仍是千问。 */
  provider: ProviderId;
  /** 五家分槽。切厂商只换槽，不覆盖别家的 Key。 */
  providers: Record<ProviderId, ProviderSlot>;
  /** 当前厂商的 Key，和 providers[provider].apiKey 同步。旧调用点继续读它。 */
  apiKey: string;
  /** 当前厂商的文本模型。 */
  model: string;
  /**
   * 当前厂商识译要用的模型。
   * 千问是单独的视觉模型；OpenAI / 火山等于当前文本模型；没有视觉能力时为空。
   */
  visionModel: string;
  sourceLang: string;
  targetLang: string;
  selectionEnabled: boolean;
  selectionMode: SelectionMode;
  /** 打开后才强制放开站点禁划选的正文。新装默认关。 */
  forceSelectEnabled: boolean;
  /** 右键拐角手势。新装默认开；关掉后只留快捷键和按钮。 */
  gestureEnabled: boolean;
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
  const providers = emptyProviders();
  return {
    provider: "qwen",
    providers,
    apiKey: "",
    model: DEFAULT_MODEL,
    sourceLang: "auto",
    targetLang: "zh",
    selectionEnabled: true,
    selectionMode: "confirm",
    forceSelectEnabled: false,
    visionModel: DEFAULT_VISION_MODEL,
    gestureEnabled: true,
    glossary: [],
  };
}

export function isCuratedModel(value: string): boolean {
  return CURATED_MODELS.includes(value);
}

export function isModelId(value: unknown): value is string {
  return typeof value === "string" && MODEL_ID_PATTERN.test(value);
}

/** 千问槽：不认识的 id 退回默认。合法的旧 id（qwen-plus 等）原样保留。 */
export function normalizeModelId(value: unknown): string {
  return normalizeProviderModel("qwen", value);
}

export function normalizeProviderModel(provider: ProviderId, value: unknown): string {
  const fallback = PROVIDERS[provider].defaultModel;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!isModelId(trimmed)) return fallback;
  return trimmed;
}

export function normalizeSelectionMode(value: unknown): SelectionMode {
  return value === "immediate" ? "immediate" : "confirm";
}

/** 空的或写坏的视觉模型退回 qwen3-vl-plus，不用文本模型顶上。 */
export function normalizeVisionModel(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_VISION_MODEL;
  const trimmed = value.trim();
  if (!isModelId(trimmed)) return DEFAULT_VISION_MODEL;
  return trimmed;
}

/** 手填优先。留空则用这家精选。第三个参数缺省时按千问，旧测试不用改。 */
export function resolveModelChoice(
  selected: string,
  customRaw: string,
  provider: ProviderId = "qwen",
): ModelChoice | ModelChoiceError {
  const profile = PROVIDERS[provider];
  const custom = customRaw.trim();
  if (custom) {
    if (!isModelId(custom)) {
      const message = provider === "qwen"
        ? INVALID_MODEL_MESSAGE
        : `模型 id 无效。请改成${profile.label}的 model id 后再试——不会假翻。`;
      return { ok: false, message };
    }
    return { ok: true, model: custom, source: "custom" };
  }
  if (isProviderCurated(provider, selected)) return { ok: true, model: selected, source: "curated" };
  return { ok: true, model: profile.defaultModel, source: "curated" };
}

/**
 * 没有 providers 槽的旧记录：把顶层 Key / 模型写进千问，当前厂商仍是千问。
 * 已经有槽时，槽是唯一来源，顶层 apiKey 只是镜像，不能反过来覆盖别的厂商。
 */
export function isLegacySettingsRecord(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  return !hasProviderMap((raw as { providers?: unknown }).providers);
}

export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const providers = emptyProviders();
  if (hasProviderMap(record.providers)) {
    for (const id of Object.keys(providers) as ProviderId[]) {
      providers[id] = normalizeSlot(id, record.providers[id]);
    }
  } else {
    providers.qwen = {
      apiKey: typeof record.apiKey === "string" ? record.apiKey.trim() : "",
      model: normalizeModelId(record.model),
      visionModel: normalizeVisionModel(record.visionModel),
    };
  }
  const provider: ProviderId = hasProviderMap(record.providers) && isProviderId(record.provider)
    ? record.provider
    : "qwen";
  const active = providers[provider];
  return {
    provider,
    providers,
    apiKey: active.apiKey,
    model: active.model,
    visionModel: mirrorVision(provider, providers),
    sourceLang: isSourceLang(record.sourceLang) ? record.sourceLang : base.sourceLang,
    targetLang: isTargetLang(record.targetLang) ? record.targetLang : base.targetLang,
    selectionEnabled: typeof record.selectionEnabled === "boolean" ? record.selectionEnabled : true,
    selectionMode: normalizeSelectionMode(record.selectionMode),
    forceSelectEnabled: record.forceSelectEnabled === true,
    gestureEnabled: typeof record.gestureEnabled === "boolean" ? record.gestureEnabled : true,
    glossary: normalizeGlossary(record.glossary),
  };
}

/** 把 Key / 模型写进指定槽，不碰其他槽，也不因此切换当前厂商。 */
export function updateProviderSlot(
  settings: Settings,
  provider: ProviderId,
  patch: { apiKey?: string; model?: string; visionModel?: string },
): Settings {
  const current = settings.providers[provider];
  const providers: Record<ProviderId, ProviderSlot> = {
    ...settings.providers,
    [provider]: {
      apiKey: patch.apiKey != null ? patch.apiKey.trim() : current.apiKey,
      model: patch.model != null ? patch.model : current.model,
      visionModel: provider === "qwen" && patch.visionModel != null ? patch.visionModel : current.visionModel,
    },
  };
  return normalizeSettings({ ...settings, provider: settings.provider, providers });
}

/** 切换当前厂商，使用该槽里已经存好的 Key 和模型。 */
export function activateProvider(settings: Settings, provider: ProviderId): Settings {
  return normalizeSettings({ ...settings, provider, providers: settings.providers });
}

export function readSettings(): Promise<Settings> {
  return chrome.storage.local.get(STORAGE_KEY).then(async (bag) => {
    const raw = bag[STORAGE_KEY];
    const settings = normalizeSettings(raw);
    if (isLegacySettingsRecord(raw)) {
      await chrome.storage.local.set({ [STORAGE_KEY]: settings });
    }
    return settings;
  });
}

export function writeSettings(settings: Settings): Promise<void> {
  return chrome.storage.local.set({ [STORAGE_KEY]: normalizeSettings(settings) }).then(() => undefined);
}

function emptyProviders(): Record<ProviderId, ProviderSlot> {
  return {
    qwen: { apiKey: "", model: PROVIDERS.qwen.defaultModel, visionModel: DEFAULT_VISION_MODEL },
    openai: { apiKey: "", model: PROVIDERS.openai.defaultModel, visionModel: "" },
    volcano: { apiKey: "", model: PROVIDERS.volcano.defaultModel, visionModel: "" },
    deepseek: { apiKey: "", model: PROVIDERS.deepseek.defaultModel, visionModel: "" },
    kimi: { apiKey: "", model: PROVIDERS.kimi.defaultModel, visionModel: "" },
  };
}

function hasProviderMap(value: unknown): value is Partial<Record<ProviderId, unknown>> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (Object.keys(PROVIDERS) as ProviderId[]).some((id) => {
    const slot = record[id];
    return Boolean(slot) && typeof slot === "object";
  });
}

function normalizeSlot(id: ProviderId, raw: unknown): ProviderSlot {
  const fallback = emptyProviders()[id];
  if (!raw || typeof raw !== "object") return fallback;
  const record = raw as Partial<ProviderSlot>;
  return {
    apiKey: typeof record.apiKey === "string" ? record.apiKey.trim() : "",
    model: normalizeProviderModel(id, record.model),
    visionModel: id === "qwen" ? normalizeVisionModel(record.visionModel) : "",
  };
}

function mirrorVision(provider: ProviderId, providers: Record<ProviderId, ProviderSlot>): string {
  const mode = PROVIDERS[provider].vision;
  if (mode === "dedicated") return providers.qwen.visionModel;
  if (mode === "chat") return providers[provider].model;
  return "";
}
