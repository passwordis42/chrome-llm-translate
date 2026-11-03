import type { SelectionMode } from "./settings.ts";

export const MAX_SELECTION_CHARS = 5000;

export type SelectionClass = "empty" | "too_long" | "ok";

export function cleanSelection(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function classifySelection(text: string): SelectionClass {
  const cleaned = cleanSelection(text);
  if (!cleaned) return "empty";
  if (cleaned.length > MAX_SELECTION_CHARS) return "too_long";
  return "ok";
}

/** 划词开关只约束「选中即弹」。右键「翻译选中内容」不走这里。 */
export function shouldOfferSelection(selectionEnabled: boolean, text: string): boolean {
  if (!selectionEnabled) return false;
  return classifySelection(text) !== "empty";
}

export type SelectionOffer = "none" | "confirm" | "translate";

/**
 * confirm：只出确认条，不请求模型。
 * translate：划完即翻，沿用现有浮层并立刻请求。
 */
export function selectionOffer(opts: {
  selectionEnabled: boolean;
  selectionMode: SelectionMode;
  text: string;
}): SelectionOffer {
  if (!shouldOfferSelection(opts.selectionEnabled, opts.text)) return "none";
  return opts.selectionMode === "immediate" ? "translate" : "confirm";
}

/** 确认条里的一行预览。视觉截断交给样式，这里只收成单行。 */
export function selectionPreview(text: string): string {
  return cleanSelection(text).replace(/\s+/g, " ").trim();
}
