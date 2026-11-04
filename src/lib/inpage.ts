/** 整页 AI：原文字位替换，并按可见性分批续翻。不插入段下译文槽。 */

export const PAGE_BATCH_LIMIT = 200;

export const TOOLBAR_META = "译文直接替换原文；下滑自动续翻；清除可还原";
export const SCROLL_HINT = "继续下滑将自动续翻未译段落（每批最多 200 段）";
export const STOPPED_HINT = "已中断 · 已翻段落保留，可继续";
export const TOOLBAR_STOPPED_HINT = "已中断；已翻段落保留。点「继续翻译」从未译段续翻（每批最多 200 段）。";
export const CONFIRM_LEAD = "用千问把整页";
export const CONFIRM_EMPHASIS = "原位替换为译文";
export const CONFIRM_DETAIL =
  "可见区直接换成译文；下滑露出新字自动续翻（每批最多 200 段）；可一键清除还原原文。";

export const REPLACED_ATTR = "data-yifan-replaced";

export type PageRunState = "idle" | "running" | "stopped" | "done";

export interface PageControlStatus {
  ok: true;
  state: PageRunState;
  label: string;
  hint: string;
  canStart: boolean;
  canStop: boolean;
  canClear: boolean;
  startLabel: "开始" | "继续";
  progress: number | null;
}

export interface PageRunInput {
  open: boolean;
  stopped: boolean;
  pending: boolean;
  doneCount: number;
  totalCount: number;
  error?: string;
}

const IDLE_STATUS: PageControlStatus = {
  ok: true,
  state: "idle",
  label: "当前页 · 空闲",
  hint: "点开始，整页原位换成译文",
  canStart: true,
  canStop: false,
  canClear: false,
  startLabel: "开始",
  progress: null,
};

/** 主弹窗和工具条共用的整页状态。停止只中断，不把已译段算回去。 */
export function derivePageStatus(input: PageRunInput): PageControlStatus {
  if (!input.open) return IDLE_STATUS;
  if (input.stopped) {
    const error = input.error?.trim() ?? "";
    return {
      ok: true,
      state: "stopped",
      label: "已停止 · 已翻保留",
      hint: error || STOPPED_HINT,
      canStart: true,
      canStop: false,
      canClear: true,
      startLabel: "继续",
      progress: null,
    };
  }
  if (input.pending) {
    const progress = input.totalCount > 0 ? Math.min(1, Math.max(0, input.doneCount / input.totalCount)) : 0;
    return {
      ok: true,
      state: "running",
      label: "翻译中…",
      hint: "正在替换可见区；下滑续翻",
      canStart: false,
      canStop: true,
      canClear: true,
      startLabel: "开始",
      progress,
    };
  }
  return {
    ok: true,
    state: "done",
    label: "本页已翻完",
    hint: "先清除可整页重翻；或再点开始查漏",
    canStart: true,
    canStop: false,
    canClear: true,
    startLabel: "开始",
    progress: null,
  };
}

/** 运行中忽略再次开始。已停止或已完成只续未译段，不重开一页。 */
export function startKind(state: PageRunState): "fresh" | "resume" | "busy" {
  if (state === "running") return "busy";
  if (state === "stopped" || state === "done") return "resume";
  return "fresh";
}

export function toolbarChip(state: PageRunState, pair: string): {
  text: string;
  live: boolean;
  tone: "run" | "stopped" | "done" | "idle";
} {
  if (state === "running") return { text: `翻译中 · ${pair}`, live: true, tone: "run" };
  if (state === "stopped") return { text: `已停止 · ${pair}`, live: false, tone: "stopped" };
  if (state === "done") return { text: `已完成 · ${pair}`, live: false, tone: "done" };
  return { text: pair, live: false, tone: "idle" };
}

/** 页内工具条：只有已停止才露出「继续翻译」。翻译中以停止为主。复制和清除一直留着。 */
export function toolbarActions(state: PageRunState): {
  resume: boolean;
  stop: boolean;
  copy: boolean;
  clear: boolean;
} {
  if (state === "running") return { resume: false, stop: true, copy: true, clear: true };
  if (state === "stopped") return { resume: true, stop: false, copy: true, clear: true };
  if (state === "done") return { resume: false, stop: false, copy: true, clear: true };
  return { resume: false, stop: false, copy: false, clear: false };
}

/** 中断后把未完成段落移出进行中集合，续翻才能再次取到。已完成的留下。 */
export function releaseUnfinished(queued: Set<string>, done: ReadonlySet<string>): void {
  for (const id of [...queued]) {
    if (!done.has(id)) queued.delete(id);
  }
}

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
