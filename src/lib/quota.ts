import { estimateCost, formatMoney } from "./pricing.ts";
import { PROVIDERS, type ProviderId } from "./providers.ts";
import type { TokenUsage } from "./sse.ts";

/** 和设置分开存，避免改语言时把累计估算冲掉。 */
export const USAGE_KEY = "yifan.usage.v1";

export interface ProviderUsage {
  lastPromptTokens: number;
  lastCompletionTokens: number;
  /** null：最近一次没有 usage，不能编金额。 */
  lastCost: number | null;
  cumulativeCost: number;
  callsWithUsage: number;
  callsWithoutUsage: number;
}

export interface UsageLedger {
  byProvider: Record<ProviderId, ProviderUsage>;
}

export interface QuotaView {
  tone: "balance" | "estimate";
  main: string;
  sub: string;
  badge: "余额" | "估算";
  label: string;
}

export function emptyUsage(): ProviderUsage {
  return {
    lastPromptTokens: 0,
    lastCompletionTokens: 0,
    lastCost: null,
    cumulativeCost: 0,
    callsWithUsage: 0,
    callsWithoutUsage: 0,
  };
}

export function emptyLedger(): UsageLedger {
  return {
    byProvider: {
      qwen: emptyUsage(),
      openai: emptyUsage(),
      volcano: emptyUsage(),
      deepseek: emptyUsage(),
      kimi: emptyUsage(),
    },
  };
}

export function normalizeUsage(raw: unknown): ProviderUsage {
  const base = emptyUsage();
  if (!raw || typeof raw !== "object") return base;
  const record = raw as Partial<ProviderUsage>;
  return {
    lastPromptTokens: nonNegative(record.lastPromptTokens, 0),
    lastCompletionTokens: nonNegative(record.lastCompletionTokens, 0),
    lastCost: typeof record.lastCost === "number" && Number.isFinite(record.lastCost) ? record.lastCost : null,
    cumulativeCost: nonNegative(record.cumulativeCost, 0),
    callsWithUsage: nonNegative(record.callsWithUsage, 0),
    callsWithoutUsage: nonNegative(record.callsWithoutUsage, 0),
  };
}

export function normalizeLedger(raw: unknown): UsageLedger {
  const base = emptyLedger();
  if (!raw || typeof raw !== "object") return base;
  const byProvider = (raw as { byProvider?: unknown }).byProvider;
  if (!byProvider || typeof byProvider !== "object") return base;
  const record = byProvider as Partial<Record<ProviderId, unknown>>;
  return {
    byProvider: {
      qwen: normalizeUsage(record.qwen),
      openai: normalizeUsage(record.openai),
      volcano: normalizeUsage(record.volcano),
      deepseek: normalizeUsage(record.deepseek),
      kimi: normalizeUsage(record.kimi),
    },
  };
}

/** 有 usage 才累加金额。没有 usage 只记次数，并把「本次」标成无法估算。 */
export function nextUsage(
  provider: ProviderId,
  model: string,
  prev: ProviderUsage,
  usage: TokenUsage | null,
): ProviderUsage {
  if (!usage) {
    return {
      ...prev,
      lastPromptTokens: 0,
      lastCompletionTokens: 0,
      lastCost: null,
      callsWithoutUsage: prev.callsWithoutUsage + 1,
    };
  }
  const cost = estimateCost(provider, model, usage);
  return {
    lastPromptTokens: usage.promptTokens,
    lastCompletionTokens: usage.completionTokens,
    lastCost: cost,
    cumulativeCost: prev.cumulativeCost + cost,
    callsWithUsage: prev.callsWithUsage + 1,
    callsWithoutUsage: prev.callsWithoutUsage,
  };
}

export function estimateView(provider: ProviderId, usage: ProviderUsage): QuotaView {
  return {
    tone: "estimate",
    badge: "估算",
    label: "额度估算",
    main: estimateMain(provider, usage),
    sub: estimateSub(provider, usage),
  };
}

export function parseDeepseekBalance(json: unknown): { amount: number; currency: "CNY" | "USD" } | null {
  if (!json || typeof json !== "object") return null;
  const infos = (json as { balance_infos?: unknown }).balance_infos;
  if (!Array.isArray(infos)) return null;
  const rows: Array<{ amount: number; currency: "CNY" | "USD" }> = [];
  for (const item of infos) {
    if (!item || typeof item !== "object") continue;
    const row = item as { currency?: unknown; total_balance?: unknown };
    const amount = asAmount(row.total_balance);
    if (amount == null) continue;
    const currency = String(row.currency ?? "").toUpperCase();
    if (currency !== "CNY" && currency !== "USD") continue;
    rows.push({ amount, currency });
  }
  return rows.find((row) => row.currency === "CNY") ?? rows[0] ?? null;
}

export function parseKimiBalance(json: unknown): { amount: number } | null {
  if (!json || typeof json !== "object") return null;
  const record = json as {
    code?: unknown;
    status?: unknown;
    data?: unknown;
    available_balance?: unknown;
  };
  if (record.code != null && record.code !== 0) return null;
  if (record.status === false) return null;
  const data = record.data && typeof record.data === "object"
    ? (record.data as { available_balance?: unknown }).available_balance
    : undefined;
  const amount = asAmount(data ?? record.available_balance);
  return amount == null ? null : { amount };
}

export async function queryBalance(opts: {
  provider: ProviderId;
  apiKey: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ ok: true; amount: number; currency: "CNY" | "USD" } | { ok: false; reason: string }> {
  const spec = PROVIDERS[opts.provider].balance;
  if (!spec) return { ok: false, reason: "这家不能用聊天 Key 查余额" };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const signal = opts.signal ?? new AbortController().signal;
  let response: Response;
  try {
    response = await fetchImpl(spec.url, {
      method: "GET",
      signal: mergeSignal(signal, 15_000),
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        Accept: "application/json",
      },
    });
  } catch (error) {
    if (signal.aborted) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, reason: "余额查询失败：网络超时" };
    return { ok: false, reason: "余额查询失败：网络不可达" };
  }
  const text = await response.text().catch(() => "");
  if (!response.ok) return { ok: false, reason: balanceHttpReason(response.status) };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "余额查询失败：返回无法解析" };
  }
  if (spec.parser === "deepseek") {
    const parsed = parseDeepseekBalance(json);
    if (!parsed) return { ok: false, reason: "余额查询失败：返回里没有可用余额" };
    return { ok: true, amount: parsed.amount, currency: parsed.currency };
  }
  const parsed = parseKimiBalance(json);
  if (!parsed) return { ok: false, reason: "余额查询失败：返回里没有可用余额" };
  return { ok: true, amount: parsed.amount, currency: "CNY" };
}

export async function loadQuotaView(opts: {
  provider: ProviderId;
  apiKey: string;
  usage: ProviderUsage;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<QuotaView> {
  const profile = PROVIDERS[opts.provider];
  if (!profile.balance) return estimateView(opts.provider, opts.usage);
  if (!opts.apiKey.trim()) {
    return {
      tone: "estimate",
      badge: "余额",
      label: "账户余额",
      main: "尚未填写 API Key",
      sub: profile.balance.pendingNote,
    };
  }
  const result = await queryBalance({
    provider: opts.provider,
    apiKey: opts.apiKey.trim(),
    fetchImpl: opts.fetchImpl,
    signal: opts.signal,
  });
  if (!result.ok) {
    const estimate = estimateView(opts.provider, opts.usage);
    return { ...estimate, sub: `${result.reason}，已改为本地估算` };
  }
  return {
    tone: "balance",
    badge: "余额",
    label: "账户余额",
    main: `${profile.balance.headline} ${formatMoney(result.amount, result.currency)}`,
    sub: profile.balance.sourceNote,
  };
}

export async function readLedger(): Promise<UsageLedger> {
  if (!hasChromeStorage()) return emptyLedger();
  try {
    const bag = await chrome.storage.local.get(USAGE_KEY);
    return normalizeLedger(bag[USAGE_KEY]);
  } catch {
    return emptyLedger();
  }
}

/** 记不住用量时静默跳过，翻译本身仍然算成功。 */
export async function rememberCall(provider: ProviderId, model: string, usage: TokenUsage | null): Promise<void> {
  if (!hasChromeStorage()) return;
  try {
    const ledger = await readLedger();
    ledger.byProvider[provider] = nextUsage(provider, model, ledger.byProvider[provider], usage);
    await chrome.storage.local.set({ [USAGE_KEY]: ledger });
  } catch {
    // 估算是附加信息。
  }
}

function estimateMain(provider: ProviderId, usage: ProviderUsage): string {
  const currency = PROVIDERS[provider].currency;
  const total = formatMoney(usage.cumulativeCost, currency);
  if (usage.callsWithUsage === 0 && usage.callsWithoutUsage === 0) {
    return `本次暂无用量 · 本扩展累计估算 ${formatMoney(0, currency)}`;
  }
  if (usage.lastCost == null && usage.callsWithUsage === 0) {
    const count = usage.callsWithoutUsage;
    return `本次未返回用量 · 本扩展累计 ${count} 次（未估金额）`;
  }
  if (usage.lastCost == null) return `本次未返回用量 · 本扩展累计估算 ${total}`;
  return `本次约 ${formatMoney(usage.lastCost, currency)} · 本扩展累计估算 ${total}`;
}

function estimateSub(provider: ProviderId, usage: ProviderUsage): string {
  const note = PROVIDERS[provider].estimateNote;
  if (usage.lastCost == null && usage.callsWithoutUsage > 0) {
    return `本次响应没有 usage，未估这次金额。${note}`;
  }
  return note;
}

function balanceHttpReason(status: number): string {
  if (status === 401 || status === 403) return "余额查询失败：Key 无效或无权限";
  if (status === 402) return "余额查询失败：额度不足或未开通";
  if (status === 429) return "余额查询失败：请求过于频繁";
  if (status >= 500) return "余额查询失败：服务暂时不可用";
  return `余额查询失败：HTTP ${status}`;
}

function asAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function nonNegative(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function mergeSignal(userSignal: AbortSignal, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (typeof AbortSignal.any === "function") return AbortSignal.any([userSignal, timeout]);
  return userSignal;
}
