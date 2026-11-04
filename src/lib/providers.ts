import { QWEN_CHAT_COMPLETIONS_URL } from "./endpoint.ts";

/**
 * v0.1.9 五家厂商。端点固定，本版没有自定义 Base URL，也不收云厂商 AK/SK。
 * 余额能不能查，见各家的 balance 字段；查不到的三家只做本地估算。
 */
export const PROVIDER_IDS = ["qwen", "openai", "volcano", "deepseek", "kimi"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const DEFAULT_MODEL = "qwen3.7-plus";

/** 框选识译专用，和千问文本三档分开。主弹窗和设置页都不露出这项。 */
export const DEFAULT_VISION_MODEL = "qwen3-vl-plus";

export const NO_VISION_OCR_MESSAGE = "当前厂商不支持截图识译";

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

export interface ModelTier {
  id: string;
  label: string;
  models: readonly string[];
}

export type VisionMode = "dedicated" | "chat" | "none";

export interface BalanceSpec {
  url: string;
  parser: "deepseek" | "kimi";
  /** 查到余额时的副文，和设置稿一致。 */
  sourceNote: string;
  /** 还没填 Key。 */
  pendingNote: string;
  headline: "账户剩余" | "可用余额";
}

export interface ProviderProfile {
  id: ProviderId;
  label: string;
  keyHint: string;
  chatCompletionsUrl: string;
  currency: "CNY" | "USD";
  defaultModel: string;
  modelTiers: readonly ModelTier[];
  modelLabel: string;
  modelHint: string;
  customLabel: string;
  customHint: string;
  customPlaceholder: string;
  customAria: string;
  /**
   * dedicated：千问，识译用单独的视觉模型，不跟文本模型走。
   * chat：当前文本模型本身能看图（OpenAI 精选、火山方舟当前模型 / ep）。
   * none：这家没有视觉模型，识译入口直接禁用。
   */
  vision: VisionMode;
  /** 只给千问。DashScope 需要关掉思考，别的家不认识这个字段。 */
  disableThinking: boolean;
  /** 流式时附带 stream_options.include_usage。不确定的家省略，避免整段翻译 400。 */
  includeStreamUsage: boolean;
  /** 估算态副文。余额家只在查询失败时改用「失败原因 + 已改为本地估算」。 */
  estimateNote: string;
  balance: BalanceSpec | null;
}

const OPENAI_TIERS: readonly ModelTier[] = [
  { id: "curated", label: "精选", models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1"] },
];

const VOLCANO_TIERS: readonly ModelTier[] = [
  {
    id: "curated",
    label: "精选示例",
    models: ["doubao-seed-1.6", "doubao-1.5-pro-32k", "doubao-1.5-lite-32k"],
  },
];

const DEEPSEEK_TIERS: readonly ModelTier[] = [
  { id: "curated", label: "精选", models: ["deepseek-chat", "deepseek-reasoner"] },
];

const KIMI_TIERS: readonly ModelTier[] = [
  { id: "curated", label: "精选", models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"] },
];

export const PROVIDERS: Record<ProviderId, ProviderProfile> = {
  qwen: {
    id: "qwen",
    label: "千问（百炼）",
    keyHint: "本地存储 · 直连百炼",
    chatCompletionsUrl: QWEN_CHAT_COMPLETIONS_URL,
    currency: "CNY",
    defaultModel: DEFAULT_MODEL,
    modelTiers: MODEL_TIERS,
    modelLabel: "模型",
    modelHint: "默认均衡 · qwen3.7-plus",
    customLabel: "自定义 model id",
    customHint: "可选手填",
    customPlaceholder: "例如 qwen-plus（留空则用上方精选）",
    customAria: "自定义 model id",
    vision: "dedicated",
    disableThinking: true,
    includeStreamUsage: true,
    estimateNote: "聊天 Key 查不到账户余额，仅本地估算",
    balance: null,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    keyHint: "本地存储 · api.openai.com",
    chatCompletionsUrl: "https://api.openai.com/v1/chat/completions",
    currency: "USD",
    defaultModel: "gpt-4o-mini",
    modelTiers: OPENAI_TIERS,
    modelLabel: "模型",
    modelHint: "默认 · gpt-4o-mini",
    customLabel: "自定义 model id",
    customHint: "可选手填",
    customPlaceholder: "例如 gpt-4o-mini（留空则用上方精选）",
    customAria: "自定义 model id",
    vision: "chat",
    disableThinking: false,
    includeStreamUsage: true,
    estimateNote: "普通 sk- 查不到账单余额，仅本地估算",
    balance: null,
  },
  volcano: {
    id: "volcano",
    label: "火山引擎",
    keyHint: "本地存储 · 方舟兼容端点",
    chatCompletionsUrl: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    currency: "CNY",
    defaultModel: "doubao-seed-1.6",
    modelTiers: VOLCANO_TIERS,
    modelLabel: "模型 / 接入点",
    modelHint: "可填 ep-… 接入点",
    customLabel: "自定义 model / ep id",
    customHint: "手填优先",
    customPlaceholder: "例如 ep-2024xxxxxxxx（方舟接入点）",
    customAria: "自定义 model 或接入点",
    vision: "chat",
    disableThinking: false,
    includeStreamUsage: false,
    estimateNote: "方舟 Key 查不到套餐余额，仅本地估算（本版不收 AK/SK）",
    balance: null,
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    keyHint: "本地存储 · api.deepseek.com",
    chatCompletionsUrl: "https://api.deepseek.com/chat/completions",
    currency: "CNY",
    defaultModel: "deepseek-chat",
    modelTiers: DEEPSEEK_TIERS,
    modelLabel: "模型",
    modelHint: "默认 · deepseek-chat",
    customLabel: "自定义 model id",
    customHint: "可选手填",
    customPlaceholder: "例如 deepseek-chat（留空则用上方精选）",
    customAria: "自定义 model id",
    vision: "none",
    disableThinking: false,
    includeStreamUsage: true,
    estimateNote: "余额查询失败时只做本地估算",
    balance: {
      url: "https://api.deepseek.com/user/balance",
      parser: "deepseek",
      sourceNote: "来自 DeepSeek /user/balance · 可用余额",
      pendingNote: "填写后查询 DeepSeek /user/balance · 可用余额",
      headline: "账户剩余",
    },
  },
  kimi: {
    id: "kimi",
    label: "Kimi",
    keyHint: "本地存储 · api.moonshot.cn",
    chatCompletionsUrl: "https://api.moonshot.cn/v1/chat/completions",
    currency: "CNY",
    defaultModel: "moonshot-v1-8k",
    modelTiers: KIMI_TIERS,
    modelLabel: "模型",
    modelHint: "默认 · moonshot-v1-8k",
    customLabel: "自定义 model id",
    customHint: "可选手填",
    customPlaceholder: "例如 moonshot-v1-8k（留空则用上方精选）",
    customAria: "自定义 model id",
    vision: "none",
    disableThinking: false,
    includeStreamUsage: false,
    estimateNote: "余额查询失败时只做本地估算",
    balance: {
      url: "https://api.moonshot.cn/v1/users/me/balance",
      parser: "kimi",
      sourceNote: "来自 Kimi /v1/users/me/balance · available_balance",
      pendingNote: "填写后查询 Kimi /v1/users/me/balance · available_balance",
      headline: "可用余额",
    },
  },
};

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

export function isProviderCurated(provider: ProviderId, model: string): boolean {
  return PROVIDERS[provider].modelTiers.some((tier) => tier.models.includes(model));
}

export function providerSupportsVision(provider: string | undefined): boolean {
  if (!provider) return PROVIDERS.qwen.vision !== "none";
  if (!isProviderId(provider)) return false;
  return PROVIDERS[provider].vision !== "none";
}

/** 识译要用的 model id。这家没有视觉模型时返回 null，调用方不许换一家。 */
export function visionCallModel(settings: {
  provider?: string;
  model?: string;
  visionModel?: string;
  providers?: Partial<Record<ProviderId, { visionModel?: string }>>;
}): string | null {
  const provider = settings.provider && isProviderId(settings.provider) ? settings.provider : "qwen";
  const mode = PROVIDERS[provider].vision;
  if (mode === "none") return null;
  if (mode === "dedicated") {
    const mirror = settings.visionModel?.trim() ?? "";
    const slot = settings.providers?.qwen?.visionModel?.trim() ?? "";
    return mirror || slot || DEFAULT_VISION_MODEL;
  }
  const model = settings.model?.trim() ?? "";
  return model || null;
}
