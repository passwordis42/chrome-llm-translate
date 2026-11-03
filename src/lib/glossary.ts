export interface GlossaryEntry {
  id: string;
  source: string;
  target: string;
}

export interface GlossaryToken {
  token: string;
  source: string;
  target: string;
}

export interface AppliedGlossary {
  text: string;
  tokens: GlossaryToken[];
}

const MAX_ENTRIES = 200;
const MAX_SOURCE = 80;
const MAX_TARGET = 200;

export function normalizeGlossary(raw: unknown): GlossaryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: GlossaryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as { id?: unknown; source?: unknown; target?: unknown };
    const source = typeof record.source === "string" ? record.source.trim() : "";
    const target = typeof record.target === "string" ? record.target.trim() : "";
    if (!source || !target) continue;
    if (source.length > MAX_SOURCE || target.length > MAX_TARGET) continue;
    const id =
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : `g${out.length}-${source.slice(0, 12)}`;
    out.push({ id, source, target });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

/**
 * 长词优先、不重叠。拉丁词用边界，避免 key 命中 keyboard。
 * 命中处换成 [[YF0]] 这类占位符，模型必须原样保留，回来再换回固定译法。
 */
export function applyGlossary(text: string, entries: GlossaryEntry[]): AppliedGlossary {
  const sorted = normalizeGlossary(entries).sort((a, b) => b.source.length - a.source.length);
  let result = text;
  const tokens: GlossaryToken[] = [];
  for (const entry of sorted) {
    const matcher = buildMatcher(entry.source);
    if (!matcher.test(result)) continue;
    matcher.lastIndex = 0;
    const token = `[[YF${tokens.length}]]`;
    result = result.replace(matcher, token);
    tokens.push({ token, source: entry.source, target: entry.target });
  }
  return { text: result, tokens };
}

export function restoreGlossary(text: string, tokens: GlossaryToken[]): string {
  let out = text;
  for (const item of tokens) {
    const index = item.token.match(/(\d+)/)?.[1];
    if (!index) continue;
    const pattern = new RegExp(`\\[\\[\\s*YF\\s*${index}\\s*\\]\\]`, "g");
    out = out.replace(pattern, item.target);
  }
  return out;
}

/** 流式中间态：末尾还没写完的占位符先藏起来，避免闪一下 [[YF。 */
export function presentTranslation(raw: string, tokens: GlossaryToken[], final: boolean): string {
  const restored = restoreGlossary(raw, tokens);
  const stripped = restored.replace(/\[\[YF\d*$/u, "");
  return final ? stripped.trimEnd() : stripped;
}

function buildMatcher(source: string): RegExp {
  const trimmed = source.trim();
  const escaped = escapeRegExp(trimmed).replace(/\s+/g, "\\s+");
  const latinEdge = /^[\p{Script=Latin}\p{N}]/u.test(trimmed) || /[\p{Script=Latin}\p{N}]$/u.test(trimmed);
  if (!latinEdge) return new RegExp(escaped, "giu");
  const starts = /^[\p{L}\p{N}]/u.test(trimmed);
  const ends = /[\p{L}\p{N}]$/u.test(trimmed);
  const pre = starts ? "(?<![\\p{L}\\p{N}_])" : "";
  const post = ends ? "(?![\\p{L}\\p{N}_])" : "";
  return new RegExp(`${pre}${escaped}${post}`, "giu");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
