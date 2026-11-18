import { PORT_NAME, type PortOutbound } from "../lib/messages.ts";

export interface StreamError extends Error {
  title?: string;
  fatal?: boolean;
}

export interface TranslationDone {
  detection: "code" | "unknown" | "plain" | "legacy" | "none";
  code: string;
}

export function requestTranslation(
  text: string,
  langs: { sourceLang: string; targetLang: string },
  handlers: { signal: AbortSignal; onText: (text: string) => void },
): Promise<TranslationDone> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const port = chrome.runtime.connect({ name: PORT_NAME });
    const finish = (error?: StreamError, done?: TranslationDone) => {
      if (settled) return;
      settled = true;
      handlers.signal.removeEventListener("abort", onAbort);
      try {
        port.disconnect();
      } catch {
        // 已经断开。
      }
      if (error) reject(error);
      else resolve(done ?? { detection: "none", code: "" });
    };
    const onAbort = () => {
      const error = new DOMException("aborted", "AbortError") as StreamError;
      finish(error);
    };
    if (handlers.signal.aborted) {
      onAbort();
      return;
    }
    handlers.signal.addEventListener("abort", onAbort, { once: true });
    port.onMessage.addListener((message: PortOutbound) => {
      if (message.type === "text") handlers.onText(message.text);
      else if (message.type === "done") finish(undefined, { detection: message.detection, code: message.code });
      else if (message.type === "error") {
        const error = new Error(message.message) as StreamError;
        error.title = message.title;
        error.fatal = message.fatal;
        finish(error);
      }
    });
    port.onDisconnect.addListener(() => {
      if (settled || handlers.signal.aborted) return;
      const error = new Error("与扩展的连接中断。不会假翻。") as StreamError;
      error.title = "翻译失败";
      error.fatal = true;
      finish(error);
    });
    port.postMessage({
      type: "start",
      text,
      sourceLang: langs.sourceLang,
      targetLang: langs.targetLang,
    });
  });
}
