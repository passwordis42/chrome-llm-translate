import { QWEN_CHAT_COMPLETIONS_URL } from "./endpoint.ts";
import { TranslateError, emptyCompletionError, httpFailure, networkFailure, sanitizeDetail } from "./errors.ts";
import { readSseStream } from "./sse.ts";

export interface ChatBodyOptions {
  model: string;
  system?: string;
  user: string;
  stream: boolean;
  maxTokens?: number;
}

export function buildChatBody(opts: ChatBodyOptions): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    stream: opts.stream,
    temperature: 0.2,
    enable_thinking: false,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  return body;
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
  system: string;
  user: string;
  signal: AbortSignal;
  onDelta: (chunk: string) => void;
  fetchImpl?: typeof fetch;
  where?: "settings" | "float";
}): Promise<void> {
  const where = opts.where ?? "float";
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(QWEN_CHAT_COMPLETIONS_URL, {
      method: "POST",
      signal: requestSignal(opts.signal, 45_000),
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildChatBody({
          model: opts.model,
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
    const { received } = await readSseStream(response.body, opts.onDelta);
    if (!received) throw emptyCompletionError(where);
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
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const signal = opts.signal ?? new AbortController().signal;
  let response: Response;
  try {
    response = await fetchImpl(QWEN_CHAT_COMPLETIONS_URL, {
      method: "POST",
      signal: requestSignal(signal, 20_000),
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildChatBody({
          model: opts.model,
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
}

function mapFetchError(error: unknown, userSignal: AbortSignal, where: "settings" | "float"): Error {
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
