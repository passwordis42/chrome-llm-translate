import { isTargetLang } from "./languages.ts";

/** 首行缓冲硬上限（UTF-16 代码单元，与 String.length 一致）。 */
export const YF1_HEADER_LIMIT = 16;

export type Yf1Mode = "strict-auto" | "plain-specific" | "legacy-explicit";

export type Yf1Outcome = "code" | "unknown" | "plain" | "legacy" | "protocol-error" | "incomplete";

export interface Yf1Result {
  outcome: Yf1Outcome;
  /** 仅 outcome 为 code 时有目录代码。 */
  code: string | null;
  /** 可显示、可复制的正文。协议错误时为空，不含包装。 */
  text: string;
}

export interface Yf1Parser {
  push(chunk: string): string;
  finish(reason: "complete" | "abort"): Yf1Result;
}

export function protocolModeForSource(sourceLang: string): Exclude<Yf1Mode, "legacy-explicit"> {
  return sourceLang === "auto" ? "strict-auto" : "plain-specific";
}

export function createYf1Parser(mode: Yf1Mode): Yf1Parser {
  let phase: "header" | "body" | "error" | "plain" = mode === "strict-auto" ? "header" : "plain";
  let hold = "";
  let body = "";
  let code: string | null = null;
  let unknown = false;

  return {
    push(chunk: string): string {
      if (!chunk || phase === "error") return "";
      if (phase === "plain" || phase === "body") {
        body += chunk;
        return chunk;
      }
      hold += chunk;
      const lf = hold.indexOf("\n");
      if (lf === -1) {
        if (hold.length >= YF1_HEADER_LIMIT) {
          phase = "error";
          hold = "";
        }
        return "";
      }
      let line = hold.slice(0, lf);
      const rest = hold.slice(lf + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      hold = "";
      if (line.length >= YF1_HEADER_LIMIT) {
        phase = "error";
        return "";
      }
      const parsed = matchHeader(line);
      if (!parsed.ok) {
        phase = "error";
        return "";
      }
      phase = "body";
      unknown = parsed.code === "unknown";
      code = unknown ? null : parsed.code;
      body += rest;
      return rest;
    },
    finish(reason): Yf1Result {
      if (mode === "plain-specific") {
        return { outcome: reason === "complete" ? "plain" : "incomplete", code: null, text: body };
      }
      if (mode === "legacy-explicit") {
        return { outcome: reason === "complete" ? "legacy" : "incomplete", code: null, text: body };
      }
      if (phase === "header" || phase === "error") {
        return { outcome: "protocol-error", code: null, text: "" };
      }
      if (reason !== "complete") {
        return { outcome: "incomplete", code: null, text: body };
      }
      if (unknown) return { outcome: "unknown", code: null, text: body };
      return { outcome: "code", code, text: body };
    },
  };
}

function matchHeader(line: string): { ok: true; code: string } | { ok: false } {
  const matched = /^YF1 (\S+)$/.exec(line);
  if (!matched) return { ok: false };
  const code = matched[1] ?? "";
  if (line !== `YF1 ${code}`) return { ok: false };
  if (code === "unknown") return { ok: true, code };
  if (isTargetLang(code)) return { ok: true, code };
  return { ok: false };
}
