export type TranslateErrorCode = "no_key" | "auth" | "network" | "quota" | "empty" | "unknown";

export class TranslateError extends Error {
  readonly code: TranslateErrorCode;
  readonly fatal: boolean;
  readonly title: string;

  constructor(code: TranslateErrorCode, title: string, message: string, fatal: boolean) {
    super(message);
    this.name = "TranslateError";
    this.code = code;
    this.title = title;
    this.fatal = fatal;
  }
}

export function missingKeyError(where: "settings" | "float"): TranslateError {
  if (where === "settings") {
    return new TranslateError("no_key", "连接失败", "请先填写 API Key。不会假翻。", true);
  }
  return new TranslateError(
    "no_key",
    "翻译失败",
    "请先在设置中填写 API Key。不会假翻。",
    true,
  );
}

export function httpFailure(where: "settings" | "float", status: number, body: string, apiKey: string): TranslateError {
  const detail = sanitizeDetail(extractApiMessage(body), apiKey);
  if (status === 401 || status === 403) {
    const modelDenied = status === 403 && detail.length > 0 && !/api[- ]?key|unauthorized/i.test(detail);
    if (modelDenied) {
      return new TranslateError("auth", titleFor(where), `${detail}——不会假翻。`, true);
    }
    return new TranslateError("auth", titleFor(where), bodyFor(where), true);
  }
  if (status === 429) {
    return new TranslateError(
      "quota",
      titleFor(where),
      detail ? `${detail}——不会假翻。` : "请求过于频繁或额度不足。请稍后再试——不会假翻。",
      true,
    );
  }
  if (status >= 500) {
    return new TranslateError(
      "network",
      titleFor(where),
      "通义千问服务暂时不可用。请稍后再试——不会假翻。",
      true,
    );
  }
  return new TranslateError(
    "unknown",
    titleFor(where),
    detail ? `${detail}——不会假翻。` : bodyFor(where),
    true,
  );
}

export function networkFailure(where: "settings" | "float", timedOut = false): TranslateError {
  const message = timedOut
    ? "网络超时。请检查网络后重试——不会假翻。"
    : bodyFor(where);
  return new TranslateError("network", titleFor(where), message, true);
}

export function emptyCompletionError(where: "settings" | "float"): TranslateError {
  const message = where === "settings" ? "千问没有返回内容。不会假翻。" : "千问没有返回译文。不会假翻。";
  return new TranslateError("empty", titleFor(where), message, where === "settings");
}

export function tooLongError(): TranslateError {
  return new TranslateError("unknown", "翻译失败", "选区超过 5000 字，请缩短后再翻。不会假翻。", false);
}

function titleFor(where: "settings" | "float"): string {
  return where === "settings" ? "连接失败" : "翻译失败";
}

function bodyFor(where: "settings" | "float"): string {
  if (where === "settings") return "API Key 无效或网络不可达。请检查后重试——不会假翻。";
  return "API Key 无效或网络不可达。请到设置中检查后重试——不会假翻。";
}

export function extractApiMessage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed || trimmed.startsWith("<")) return "";
  try {
    const json = JSON.parse(trimmed) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const message = json.error?.message ?? json.message;
    return typeof message === "string" ? message : "";
  } catch {
    return "";
  }
}

export function sanitizeDetail(detail: string, apiKey: string): string {
  let text = detail.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (apiKey && apiKey.length > 6) text = text.split(apiKey).join("***");
  text = text.replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-***");
  if (text.length > 160) text = `${text.slice(0, 160)}…`;
  return text;
}
