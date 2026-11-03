/** 整页 AI：原文字位替换，并按可见性分批续翻。不插入段下译文槽。 */

export const PAGE_BATCH_LIMIT = 200;

export const TOOLBAR_META = "译文直接替换原文；下滑自动续翻；清除可还原";
export const SCROLL_HINT = "继续下滑将自动续翻未译段落（每批最多 200 段）";
export const CONFIRM_LEAD = "用千问把整页";
export const CONFIRM_EMPHASIS = "原位替换为译文";
export const CONFIRM_DETAIL =
  "可见区直接换成译文；下滑露出新字自动续翻（每批最多 200 段）；可一键清除还原原文。";

export const REPLACED_ATTR = "data-yifan-replaced";

export interface TextSnapshot {
  anchor: Element;
  html: string;
}

export interface ViewportRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export interface BatchBlock {
  id: string;
  anchor: Element;
}

/** 替换前记下 innerHTML。同一节点只记一次，避免把译文当成原文。 */
export function ensureSnapshot(store: Map<Element, TextSnapshot>, anchor: Element): TextSnapshot | null {
  const existing = store.get(anchor);
  if (existing) return existing;
  if (!anchor.isConnected) return null;
  if (!("innerHTML" in anchor)) return null;
  const snapshot = { anchor, html: (anchor as HTMLElement).innerHTML };
  store.set(anchor, snapshot);
  return snapshot;
}

/** 在原节点里换上译文。不新增兄弟节点，也不写「译文」标签。 */
export function replaceInPlace(snapshot: TextSnapshot, text: string): void {
  const { anchor } = snapshot;
  if (!anchor.isConnected) return;
  anchor.textContent = text;
  anchor.setAttribute(REPLACED_ATTR, "");
}

export function restoreSnapshot(snapshot: TextSnapshot): void {
  const { anchor } = snapshot;
  if (!anchor.isConnected) return;
  if ("innerHTML" in anchor) (anchor as HTMLElement).innerHTML = snapshot.html;
  anchor.removeAttribute(REPLACED_ATTR);
}

export function restoreSnapshots(list: readonly TextSnapshot[]): number {
  let count = 0;
  for (const snapshot of list) {
    if (!snapshot.anchor.isConnected) continue;
    restoreSnapshot(snapshot);
    count += 1;
  }
  return count;
}

/** 按传入顺序收集已替换译文；同一节点只取一次。 */
export function collectReplacedText(anchors: readonly Element[]): string[] {
  const seen = new Set<Element>();
  const parts: string[] = [];
  for (const anchor of anchors) {
    if (seen.has(anchor)) continue;
    seen.add(anchor);
    if (!anchor.isConnected || !anchor.hasAttribute(REPLACED_ATTR)) continue;
    const text = anchor.textContent?.trim() ?? "";
    if (text) parts.push(text);
  }
  return parts;
}

export function isInViewport(rect: ViewportRect, viewport: { width: number; height: number }): boolean {
  if (viewport.width <= 0 || viewport.height <= 0) return false;
  if (rect.width <= 0 && rect.height <= 0) return false;
  return rect.bottom > 0 && rect.top < viewport.height && rect.right > 0 && rect.left < viewport.width;
}

/**
 * 下一批要翻的段落：当前可见、还没翻、也不在进行中的批次里。
 * 最多 `limit` 段（默认 200）。调用方把这批标成完成后再次调用，才能拿到下一批——
 * 满 200 不会把后面的可见段永久丢掉。
 */
export function nextVisibleBatch<T extends BatchBlock>(
  blocks: readonly T[],
  options: {
    limit?: number;
    done?: ReadonlySet<string>;
    queued?: ReadonlySet<string>;
    isVisible: (anchor: Element) => boolean;
  },
): T[] {
  const limit = options.limit ?? PAGE_BATCH_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const done = options.done ?? new Set<string>();
  const queued = options.queued ?? new Set<string>();
  const batch: T[] = [];
  for (const block of blocks) {
    if (batch.length >= limit) break;
    if (done.has(block.id) || queued.has(block.id)) continue;
    if (!block.anchor.isConnected) continue;
    if (!options.isVisible(block.anchor)) continue;
    batch.push(block);
  }
  return batch;
}
