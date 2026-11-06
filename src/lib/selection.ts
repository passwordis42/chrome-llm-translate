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

export type SelectionOffer = "none" | "translate";

/**
 * 划词开着且选区非空：直接打开结果浮层并请求，不再出确认条。
 * 划词关着，或选区为空：不弹、不请求。
 */
export function selectionOffer(opts: {
  selectionEnabled: boolean;
  text: string;
}): SelectionOffer {
  if (!shouldOfferSelection(opts.selectionEnabled, opts.text)) return "none";
  return "translate";
}
