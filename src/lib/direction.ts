import { isTargetLang, languageByCode } from "./languages.ts";

export type TranslateEntry = "selection" | "page" | "ocr" | "input";

export const SWAP_NEED_SOURCE = "无法确定当前原文语言，请手选源语言。";
export const SWAP_UNKNOWN = "未识别出源语言，请手动选择后互换。";
export const SWAP_STALE = "原文已更改，先前识别已失效。请重新翻译，或手动选择源语言。";
export const PROTOCOL_ERROR_TEXT =
  "协议错误：响应缺头、非法代码、超长或被截断。原文已保留，未展示译文，也未记为识别成功。不会自动重试。不会假翻。";
export const INCOMPLETE_TEXT = "译文未完成，不能用于识别互换。";

export interface Direction {
  sourceLang: string;
  targetLang: string;
}

export interface SwapOk {
  ok: true;
  sourceLang: string;
  targetLang: string;
}

export interface SwapNo {
  ok: false;
  message: string;
}

/**
 * 具体源语言直接对调。auto 只用本次绑定的目录代码。
 * 两端相同也保持该代码，不改成英语。
 */
export function swapDirection(current: Direction, detectedCode: string | null): SwapOk | SwapNo {
  if (current.sourceLang !== "auto") {
    if (!isTargetLang(current.sourceLang) || !isTargetLang(current.targetLang)) {
      return { ok: false, message: SWAP_NEED_SOURCE };
    }
    return { ok: true, sourceLang: current.targetLang, targetLang: current.sourceLang };
  }
  if (!detectedCode || !isTargetLang(detectedCode)) {
    return { ok: false, message: detectedCode === "unknown" ? SWAP_UNKNOWN : SWAP_NEED_SOURCE };
  }
  return { ok: true, sourceLang: current.targetLang, targetLang: detectedCode };
}

export interface DetectionRecord {
  entry: TranslateEntry;
  scopeId: string;
  text: string;
  direction: Direction;
  token: number;
  code: string | null;
  unknown: boolean;
  usable: boolean;
}

export interface DetectionBook {
  begin(entry: TranslateEntry, scopeId: string, text: string, direction: Direction): number;
  commit(token: number, text: string, direction: Direction, code: string | null, unknown: boolean): void;
  drop(token: number): void;
  invalidateDirection(direction: Direction): void;
  invalidateText(entry: TranslateEntry, scopeId: string, text: string): void;
  usableCode(direction: Direction, entry?: TranslateEntry, text?: string): string | null;
  hint(direction: Direction, entry?: TranslateEntry, text?: string): string;
}

export function createDetectionBook(): DetectionBook {
  const records = new Map<string, DetectionRecord>();
  let seq = 0;

  function key(entry: TranslateEntry, scopeId: string): string {
    return `${entry}:${scopeId}`;
  }

  return {
    begin(entry, scopeId, text, direction) {
      seq += 1;
      records.set(key(entry, scopeId), {
        entry,
        scopeId,
        text,
        direction: { ...direction },
        token: seq,
        code: null,
        unknown: false,
        usable: false,
      });
      return seq;
    },
    commit(token, text, direction, code, unknown) {
      for (const record of records.values()) {
        if (record.token !== token) continue;
        if (record.text !== text) return;
        if (record.direction.sourceLang !== direction.sourceLang || record.direction.targetLang !== direction.targetLang) return;
        record.code = code && isTargetLang(code) ? code : null;
        record.unknown = unknown && !record.code;
        record.usable = Boolean(record.code) || record.unknown;
      }
    },
    drop(token) {
      for (const [id, record] of records) {
        if (record.token === token) records.delete(id);
      }
    },
    invalidateDirection(direction) {
      for (const [id, record] of records) {
        if (record.direction.sourceLang !== direction.sourceLang || record.direction.targetLang !== direction.targetLang) {
          records.delete(id);
        }
      }
    },
    invalidateText(entry, scopeId, text) {
      const record = records.get(key(entry, scopeId));
      if (!record || record.text === text) return;
      record.usable = false;
      record.code = null;
      record.unknown = false;
      record.text = text;
    },
    usableCode(direction, entry, text) {
      const found = latest(records, direction, entry, text);
      return found?.code ?? null;
    },
    hint(direction, entry, text) {
      if (direction.sourceLang !== "auto") return "";
      const found = latest(records, direction, entry, text);
      if (found?.code) return "";
      if (found?.unknown) return SWAP_UNKNOWN;
      const stale = [...records.values()].some((record) => record.entry === (entry ?? record.entry) && !record.usable && record.text !== (text ?? record.text));
      if (stale && text) return SWAP_STALE;
      return SWAP_NEED_SOURCE;
    },
  };
}

function latest(
  records: Map<string, DetectionRecord>,
  direction: Direction,
  entry?: TranslateEntry,
  text?: string,
): DetectionRecord | null {
  let found: DetectionRecord | null = null;
  for (const record of records.values()) {
    if (!record.usable) continue;
    if (record.direction.sourceLang !== direction.sourceLang || record.direction.targetLang !== direction.targetLang) continue;
    if (entry && record.entry !== entry) continue;
    if (text != null && record.text !== text) continue;
    if (!found || record.token > found.token) found = record;
  }
  return found;
}

export function detectedLabel(code: string): string {
  return languageByCode(code)?.label ?? code;
}
