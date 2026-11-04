import { PROVIDERS, type ProviderId } from "./providers.ts";
import { rememberCall } from "./quota.ts";
import { TranslateError, emptyCompletionError, httpFailure, networkFailure, sanitizeDetail } from "./errors.ts";
import { readSseStream, readTokenUsage, type TokenUsage } from "./sse.ts";

export interface ChatBodyOptions {
  model: string;
  system?: string;
  user: string;
  stream: boolean;
  maxTokens?: number;
  /** 缺省千问，保持旧调用。只有千问会带 enable_thinking。 */
  provider?: ProviderId;
}

export function buildChatBody(opts: ChatBodyOptions): Record<string, unknown> {
  const provider = opts.provider ?? "qwen";
  const profile = PROVIDERS[provider];
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    stream: opts.stream,
  };
  // deepseek-reasoner 不接受 temperature，带上会 400。
  if (opts.model !== "deepseek-reasoner") body.temperature = 0.2;
  if (profile.disableThinking) body.enable_thinking = false;
  if (opts.stream && profile.includeStreamUsage) body.stream_options = { include_usage: true };
  if (opts.maxTokens && opts.model !== "deepseek-reasoner") body.max_tokens = opts.maxTokens;
  return body;
}

export interface VisionBodyOptions {
  model: string;
  prompt: string;
  imageDataUrl: string;
  maxTokens?: number;
  provider?: ProviderId;
}

/** 识图走同一套兼容模式，但 content 是图文数组，并且不流式。 */
export function buildVisionBody(opts: VisionBodyOptions): Record<string, unknown> {
  const provider = opts.provider ?? "qwen";
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: opts.prompt },
          { type: "image_url", image_url: { url: opts.imageDataUrl } },
        ],
      },
    ],
    stream: false,
    temperature: 0.1,
    max_tokens: opts.maxTokens ?? 2048,
  };
  if (PROVIDERS[provider].disableThinking) body.enable_thinking = false;
  return body;
}

export function completionText(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const choice = (json as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

export function isSuccessfulCompletion(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const record = json as { error?: unknown; choices?: unknown };
  if (record.error) return false;
  return Array.isArray(record.choices) && record.choices.length > 0;
}

function requestSignal(userSignal: AbortSignal, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (typeof AbortSignal.any === "function") return AbortSignal.any([userSignal, timeout]);
  return userSignal;
}

export async function streamChat(opts: {
  apiKey: string;
  model: string;
  provider?: ProviderId;
  system: string;
  user: string;
  signal: AbortSignal;
  onDelta: (chunk: string) => void;
  fetchImpl?: typeof fetch;
  where?: "settings" | "float";
}): Promise<{ usage: TokenUsage | null }> {
  const where = opts.where ?? "float";
  const provider = opts.provider ?? "qwen";
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(PROVIDERS[provider].chatCompletionsUrl, {
      method: "POST",
      signal: requestSignal(opts.signal, 45_000),
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildChatBody({
          model: opts.model,
          provider,
          system: opts.system,
          user: opts.user,
          stream: true,
        }),
      ),
    });
  } catch (error) {
    throw mapFetchError(error, opts.signal, where);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw httpFailure(where, response.status, text, opts.apiKey);
  }
  if (!response.body) throw emptyCompletionError(where);
  try {
    const { received, usage } = await readSseStream(response.body, opts.onDelta);
    if (!received) throw emptyCompletionError(where);
    await rememberCall(provider, opts.model, usage);
    return { usage };
  } catch (error) {
    if (error instanceof TranslateError) throw error;
    if (isAbort(error)) throw mapFetchError(error, opts.signal, where);
    const message = sanitizeDetail(error instanceof Error ? error.message : "", opts.apiKey);
    if (/api[- ]?key|unauthorized|invalid api/i.test(message)) {
      throw httpFailure(where, 401, "", opts.apiKey);
    }
    throw httpFailure(where, 400, JSON.stringify({ message: message || "流式响应无法解析" }), opts.apiKey);
  }
}

export async function testConnection(opts: {
  apiKey: string;
  model: string;
  provider?: ProviderId;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const provider = opts.provider ?? "qwen";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const signal = opts.signal ?? new AbortController().signal;
  let response: Response;
  try {
    response = await fetchImpl(PROVIDERS[provider].chatCompletionsUrl, {
      method: "POST",
      signal: requestSignal(signal, 20_000),
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildChatBody({
          model: opts.model,
          provider,
          user: "请只回复 OK",
          stream: false,
          maxTokens: 8,
        }),
      ),
    });
  } catch (error) {
    throw mapFetchError(error, signal, "settings");
  }
  const text = await response.text().catch(() => "");
  if (!response.ok) throw httpFailure("settings", response.status, text, opts.apiKey);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw emptyCompletionError("settings");
  }
  if (!isSuccessfulCompletion(json)) throw emptyCompletionError("settings");
  await rememberCall(provider, opts.model, readTokenUsage(json));
}

export async function completeVision(opts: {
  apiKey: string;
  model: string;
  provider?: ProviderId;
  prompt: string;
  imageDataUrl: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const provider = opts.provider ?? "qwen";
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(PROVIDERS[provider].chatCompletionsUrl, {
      method: "POST",
      signal: requestSignal(opts.signal, 45_000),
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildVisionBody({
          model: opts.model,
          provider,
          prompt: opts.prompt,
          imageDataUrl: opts.imageDataUrl,
        }),
      ),
    });
  } catch (error) {
    throw mapFetchError(error, opts.signal, "ocr");
  }
  const text = await response.text().catch(() => "");
  if (!response.ok) throw httpFailure("ocr", response.status, text, opts.apiKey);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw emptyCompletionError("ocr");
  }
  if (!isSuccessfulCompletion(json)) throw emptyCompletionError("ocr");
  const content = completionText(json).trim();
  if (!content) throw emptyCompletionError("ocr");
  await rememberCall(provider, opts.model, readTokenUsage(json));
  return content;
}

function mapFetchError(error: unknown, userSignal: AbortSignal, where: "settings" | "float" | "ocr"): Error {
  if (userSignal.aborted) {
    return error instanceof Error ? error : new DOMException("aborted", "AbortError");
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return networkFailure(where, true);
  return networkFailure(where, false);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
