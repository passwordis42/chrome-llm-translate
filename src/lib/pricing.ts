import type { ProviderId } from "./providers.ts";
import type { TokenUsage } from "./sse.ts";

/**
 * 本地估算用的公开标价粗表，单位是每 1,000,000 tokens。
 * 不是账单：不含缓存命中、阶梯、折扣和税。允许和各家当期价目表有偏差。
 * OpenAI / 千问 / 火山只靠这张表；DeepSeek / Kimi 仅在余额接口失败时降级使用。
 *
 * 量级依据（2026-11，取文档里常见标价，按输入未命中缓存粗算）：
 * - 千问：flash 低于 plus，max 高于 plus
 * - OpenAI：gpt-4o-mini / gpt-4o / gpt-4.1 的公开美元价
 * - 火山方舟：豆包 lite 低于 pro；未列出的 ep- 接入点用 pro 这档
 * - DeepSeek：deepseek-chat / deepseek-reasoner 的缓存未命中价
 * - Kimi：moonshot-v1 按上下文长度分档，输入和输出同一单价
 */
export interface TokenRate {
  input: number;
  output: number;
}

export interface ProviderPrice {
  currency: "CNY" | "USD";
  input: number;
  output: number;
  models: Record<string, TokenRate>;
}

export const PRICE_TABLE: Record<ProviderId, ProviderPrice> = {
  qwen: {
    currency: "CNY",
    input: 0.8,
    output: 2,
    models: {
      "qwen3.5-flash": { input: 0.2, output: 2 },
      "qwen3.7-flash": { input: 0.2, output: 2 },
      "qwen3.8-flash": { input: 0.2, output: 2 },
      "qwen3.5-plus": { input: 0.8, output: 2 },
      "qwen3.6-plus": { input: 0.8, output: 2 },
      "qwen3.7-plus": { input: 0.8, output: 2 },
      "qwen3.7-max": { input: 2.4, output: 9.6 },
      "qwen3.8-max": { input: 2.4, output: 9.6 },
      "qwen3-vl-plus": { input: 1, output: 10 },
    },
  },
  openai: {
    currency: "USD",
    input: 0.15,
    output: 0.6,
    models: {
      "gpt-4o-mini": { input: 0.15, output: 0.6 },
      "gpt-4o": { input: 2.5, output: 10 },
      "gpt-4.1": { input: 2, output: 8 },
    },
  },
  volcano: {
    currency: "CNY",
    input: 0.8,
    output: 2,
    models: {
      "doubao-seed-1.6": { input: 0.8, output: 2 },
      "doubao-1.5-pro-32k": { input: 0.8, output: 2 },
      "doubao-1.5-lite-32k": { input: 0.3, output: 0.6 },
    },
  },
  deepseek: {
    currency: "CNY",
    input: 2,
    output: 8,
    models: {
      "deepseek-chat": { input: 2, output: 8 },
      "deepseek-reasoner": { input: 4, output: 16 },
    },
  },
  kimi: {
    currency: "CNY",
    input: 12,
    output: 12,
    models: {
      "moonshot-v1-8k": { input: 12, output: 12 },
      "moonshot-v1-32k": { input: 24, output: 24 },
      "moonshot-v1-128k": { input: 60, output: 60 },
    },
  },
};

export function rateFor(provider: ProviderId, model: string): TokenRate & { currency: "CNY" | "USD" } {
  const table = PRICE_TABLE[provider];
  const exact = table.models[model];
  if (exact) return { currency: table.currency, input: exact.input, output: exact.output };
  return { currency: table.currency, input: table.input, output: table.output };
}

/** 一次调用的估算金额。没有 usage 时不要调用，调用方应记次数而不是编一个 0 以外的金额。 */
export function estimateCost(provider: ProviderId, model: string, usage: TokenUsage): number {
  const rate = rateFor(provider, model);
  return (usage.promptTokens * rate.input + usage.completionTokens * rate.output) / 1_000_000;
}

export function formatMoney(amount: number, currency: "CNY" | "USD"): string {
  const symbol = currency === "USD" ? "$" : "¥";
  if (!Number.isFinite(amount)) return `${symbol}0.00`;
  const abs = Math.abs(amount);
  const digits = abs !== 0 && abs < 0.01 ? 4 : 2;
  return `${symbol}${amount.toFixed(digits)}`;
}
