/**
 * 划词结果窗（v0.1.14）：标题栏拖动 + 一键放大/还原。
 * 只活在这一次打开里，不写 storage。没有边角把手，也没有字号控件。
 * 放大只改窗口尺寸，字号保持 SELECTION_FLOAT_FONT_PX。
 */

export const SELECTION_FLOAT_MARGIN = 8;
export const SELECTION_FLOAT_DEFAULT_WIDTH = 380;
export const SELECTION_FLOAT_ENLARGED_WIDTH = 640;
export const SELECTION_FLOAT_DEFAULT_GUTTER = 16;
export const SELECTION_FLOAT_VIEWPORT_GUTTER = 48;
export const SELECTION_FLOAT_FONT_PX = 13;
export const SELECTION_FLOAT_FALLBACK_HEIGHT = 180;
/** 与识译标题栏同一颗六点全满的盲文字符 U+28FF，不要换成其它方块。 */
export const SELECTION_FLOAT_GRIP = "\u28FF";
export const SELECTION_FLOAT_DRAG_LABEL = `${SELECTION_FLOAT_GRIP} 拖动`;

export const SELECTION_FLOAT_DEFAULT_WIDTH_CSS = "min(380px, calc(100vw - 16px))";
export const SELECTION_FLOAT_ENLARGED_WIDTH_CSS = "min(640px, calc(100vw - 48px))";
export const SELECTION_FLOAT_MAX_HEIGHT_CSS = "calc(100vh - 48px)";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface SelectionFloatLayout {
  left: number;
  top: number;
  enlarged: boolean;
  /** 标题栏拖动真正挪过位置。流式更新不再吸回选区旁。 */
  moved: boolean;
  /** 卡片自然高度（含标题栏和底栏）。默认档用它收紧，超过上限则窗内滚。 */
  contentHeight: number;
}

export interface SelectionFloatController {
  getLayout(): SelectionFloatLayout | null;
  viewport(): ViewportSize;
  contentHeight(): number;
  /** 按目标档位的尺寸，算出靠近选区的默认位置。已拖过时调用方应传 null。 */
  anchor(layout: SelectionFloatLayout): { left: number; top: number } | null;
  onLayout(layout: SelectionFloatLayout): void;
  onClose(): void;
}

export interface SelectionFloatShell {
  tip: HTMLDivElement;
  head: HTMLDivElement;
  lang: HTMLSpanElement;
  pair: HTMLDivElement;
  apply(layout: SelectionFloatLayout | null): void;
}

export function selectionFloatMaxHeight(viewportHeight: number): number {
  return Math.max(1, viewportHeight - SELECTION_FLOAT_VIEWPORT_GUTTER);
}

export function selectionFloatWidth(viewportWidth: number, enlarged: boolean): number {
  const preferred = enlarged ? SELECTION_FLOAT_ENLARGED_WIDTH : SELECTION_FLOAT_DEFAULT_WIDTH;
  const gutter = enlarged ? SELECTION_FLOAT_VIEWPORT_GUTTER : SELECTION_FLOAT_DEFAULT_GUTTER;
  return Math.max(1, Math.min(preferred, viewportWidth - gutter));
}

/**
 * 默认档：短文跟内容走，长文停在视口减边距。
 * 放大档：宽高都跳到预设大尺寸，短文也不再缩回内容高。
 */
export function selectionFloatHeight(
  contentHeight: number,
  viewportHeight: number,
  enlarged: boolean,
): { height: number; scrolls: boolean } {
  const maxHeight = selectionFloatMaxHeight(viewportHeight);
  if (enlarged) return { height: maxHeight, scrolls: contentHeight > maxHeight };
  const natural = contentHeight > 0 ? contentHeight : Math.min(SELECTION_FLOAT_FALLBACK_HEIGHT, maxHeight);
  return { height: Math.min(natural, maxHeight), scrolls: natural > maxHeight };
}

export function selectionFloatRenderedSize(
  layout: Pick<SelectionFloatLayout, "enlarged" | "contentHeight">,
  viewport: ViewportSize,
): { width: number; height: number } {
  return {
    width: selectionFloatWidth(viewport.width, layout.enlarged),
    height: selectionFloatHeight(layout.contentHeight, viewport.height, layout.enlarged).height,
  };
}

export function clampSelectionFloatPosition(opts: {
  left: number;
  top: number;
  width: number;
  height: number;
  viewport: ViewportSize;
  margin?: number;
}): { left: number; top: number } {
  const margin = opts.margin ?? SELECTION_FLOAT_MARGIN;
  const maxLeft = Math.max(margin, opts.viewport.width - opts.width - margin);
  const maxTop = Math.max(margin, opts.viewport.height - opts.height - margin);
  return {
    left: Math.round(clamp(opts.left, margin, maxLeft)),
    top: Math.round(clamp(opts.top, margin, maxTop)),
  };
}

/** 已拖过则只钳制当前位置；否则用调用方给的选区锚点。 */
export function placeSelectionFloat(
  layout: SelectionFloatLayout,
  anchor: { left: number; top: number } | null,
  viewport: ViewportSize,
): SelectionFloatLayout {
  const size = selectionFloatRenderedSize(layout, viewport);
  const origin = layout.moved || !anchor ? { left: layout.left, top: layout.top } : anchor;
  const pos = clampSelectionFloatPosition({
    left: origin.left,
    top: origin.top,
    width: size.width,
    height: size.height,
    viewport,
  });
  return { ...layout, left: pos.left, top: pos.top };
}

export function dragSelectionFloat(
  layout: SelectionFloatLayout,
  dx: number,
  dy: number,
  viewport: ViewportSize,
): SelectionFloatLayout {
  const size = selectionFloatRenderedSize(layout, viewport);
  const pos = clampSelectionFloatPosition({
    left: layout.left + dx,
    top: layout.top + dy,
    width: size.width,
    height: size.height,
    viewport,
  });
  const moved = layout.moved || pos.left !== layout.left || pos.top !== layout.top;
  return { ...layout, left: pos.left, top: pos.top, moved };
}

export function toggleSelectionFloatEnlarge(
  layout: SelectionFloatLayout,
  viewport: ViewportSize,
  anchor: { left: number; top: number } | null,
): SelectionFloatLayout {
  return placeSelectionFloat({ ...layout, enlarged: !layout.enlarged }, layout.moved ? null : anchor, viewport);
}

/** 流式长高或报错换底栏时调用。不读选区，避免把用户拖过的窗弹回去。 */
export function noteSelectionFloatContent(
  layout: SelectionFloatLayout,
  contentHeight: number,
  viewport: ViewportSize,
): SelectionFloatLayout {
  return placeSelectionFloat({ ...layout, contentHeight }, null, viewport);
}

export interface SelectionFloatSession {
  current(): SelectionFloatLayout | null;
  open(anchor: { left: number; top: number }, contentHeight: number): SelectionFloatLayout;
  commit(layout: SelectionFloatLayout): SelectionFloatLayout;
  close(): void;
}

export function createSelectionFloatSession(): SelectionFloatSession {
  let layout: SelectionFloatLayout | null = null;
  return {
    current: () => layout,
    open(anchor, contentHeight) {
      layout = {
        left: anchor.left,
        top: anchor.top,
        enlarged: false,
        moved: false,
        contentHeight,
      };
      return layout;
    },
    commit(next) {
      layout = next;
      return layout;
    },
    close() {
      layout = null;
    },
  };
}

export function mountSelectionFloatShell(
  document: Document,
  controller: SelectionFloatController,
  brand?: Node,
): SelectionFloatShell {
  const tip = el(document, "div", "tip");
  tip.setAttribute("role", "dialog");
  tip.setAttribute("aria-label", "一翻划词浮层");
  tip.addEventListener("mousedown", (event) => event.stopPropagation());

  const head = el(document, "div", "tip-hd");
  head.title = "拖动标题栏挪位置";
  if (brand) head.append(brand);

  const hint = el(document, "span", "drag-hint");
  hint.setAttribute("aria-hidden", "true");
  hint.append(el(document, "span", "grip", SELECTION_FLOAT_GRIP), document.createTextNode(" 拖动"));

  const zoom = el(document, "button", "zoom-btn", "放大");
  zoom.type = "button";
  zoom.title = "一键放大窗口（字号不变）";
  zoom.setAttribute("aria-label", zoom.title);

  const lang = el(document, "span", "lang");

  const close = el(document, "button", "close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "关闭");
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    controller.onClose();
  });

  head.append(hint, zoom, lang, close);

  zoom.addEventListener("click", (event) => {
    event.stopPropagation();
    const start = freshLayout(controller);
    if (!start) return;
    const draft = { ...start, enlarged: !start.enlarged };
    const anchor = draft.moved ? null : controller.anchor(draft);
    controller.onLayout(placeSelectionFloat(draft, anchor, controller.viewport()));
  });

  head.addEventListener("pointerdown", (event) => {
    if (controlTarget(event.target)) return;
    const startPoint = pointOf(event);
    if (startPoint.button !== 0) return;
    const start = freshLayout(controller);
    if (!start) return;
    const tracked = trackPointer(
      head,
      event,
      (dx, dy) => {
        controller.onLayout(dragSelectionFloat(start, dx, dy, controller.viewport()));
      },
      () => {
        head.classList.remove("dragging");
        const current = controller.getLayout();
        if (!current) return;
        controller.onLayout(noteSelectionFloatContent(current, controller.contentHeight(), controller.viewport()));
      },
    );
    if (!tracked) return;
    event.preventDefault();
    head.classList.add("dragging");
  });

  const pair = el(document, "div", "pair");
  tip.append(head, pair);

  function apply(layout: SelectionFloatLayout | null): void {
    if (!layout) return;
    const on = layout.enlarged;
    zoom.textContent = on ? "还原" : "放大";
    zoom.classList.toggle("on", on);
    zoom.title = on ? "还原窗口大小（字号不变）" : "一键放大窗口（字号不变）";
    zoom.setAttribute("aria-label", zoom.title);
  }

  apply(controller.getLayout());
  return { tip, head, lang, pair, apply };
}

function freshLayout(controller: SelectionFloatController): SelectionFloatLayout | null {
  const start = controller.getLayout();
  if (!start) return null;
  return { ...start, contentHeight: controller.contentHeight() };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function controlTarget(target: EventTarget | null): boolean {
  const node = target as { closest?: (selector: string) => unknown } | null;
  if (!node || typeof node.closest !== "function") return false;
  return Boolean(node.closest("button, select, input, textarea, a, label, option"));
}

function el<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function pointOf(event: Event): { x: number; y: number; button: number; pointerId: number } {
  const raw = event as Event & { clientX?: number; clientY?: number; button?: number; pointerId?: number };
  return {
    x: raw.clientX ?? 0,
    y: raw.clientY ?? 0,
    button: raw.button ?? 0,
    pointerId: raw.pointerId ?? 0,
  };
}

function trackPointer(
  source: HTMLElement,
  event: Event,
  update: (dx: number, dy: number) => void,
  done?: () => void,
): boolean {
  const start = pointOf(event);
  if (start.button !== 0) return false;
  const view = source.ownerDocument.defaultView;
  if (!view) return false;
  const docEl = source.ownerDocument.documentElement;
  const previousUserSelect = docEl.style.userSelect;
  docEl.style.userSelect = "none";
  const capture = (source as HTMLElement & { setPointerCapture?: (id: number) => void }).setPointerCapture;
  if (typeof capture === "function") {
    try {
      capture.call(source, start.pointerId);
    } catch {
      /* 测试文档没有指针捕获。 */
    }
  }
  const move = (next: Event) => {
    const point = pointOf(next);
    update(point.x - start.x, point.y - start.y);
  };
  const stop = (next: Event) => {
    view.removeEventListener("pointermove", move);
    view.removeEventListener("pointerup", stop);
    view.removeEventListener("pointercancel", stop);
    if (next.type === "pointerup") move(next);
    docEl.style.userSelect = previousUserSelect;
    done?.();
  };
  view.addEventListener("pointermove", move);
  view.addEventListener("pointerup", stop);
  view.addEventListener("pointercancel", stop);
  return true;
}
