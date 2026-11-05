/**
 * 截图识译结果窗（v0.1.11）：位置、大小、字号、一键放大。
 * 只活在这一次打开里，不写 storage。加载中不进入可交互布局。
 */

export const OCR_PANEL_MARGIN = 16;
export const OCR_PANEL_DEFAULT_WIDTH = 400;
export const OCR_PANEL_ENLARGED_WIDTH = 560;
export const OCR_PANEL_MIN_WIDTH = 280;
export const OCR_PANEL_MIN_HEIGHT = 200;
export const OCR_FONT_DEFAULT = 13;
export const OCR_FONT_MIN = 12;
export const OCR_FONT_MAX = 22;
export const OCR_FONT_STEP = 1;

export const OCR_RESIZE_EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
export type OcrResizeEdge = (typeof OCR_RESIZE_EDGES)[number];
export type OcrPanelPhase = "loading" | "ready";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface OcrInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface OcrPanelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OcrPanelLayout {
  /** 本次打开时的默认大小。还原回到这里，不回到拖边角的中间态。 */
  sessionDefault: OcrPanelBox;
  box: OcrPanelBox;
  enlarged: boolean;
  fontPx: number;
  /** 标题栏拖过，或北边 / 西边改过位置。一键放大后不再吸回右下角。 */
  moved: boolean;
}

export interface OcrPanelChrome {
  drag: boolean;
  resize: boolean;
  font: boolean;
  enlarge: boolean;
}

interface Limits {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
}

export function defaultOcrInsets(): OcrInsets {
  return {
    top: OCR_PANEL_MARGIN,
    right: OCR_PANEL_MARGIN,
    bottom: OCR_PANEL_MARGIN,
    left: OCR_PANEL_MARGIN,
  };
}

export function isOcrResizeEdge(value: string | undefined): value is OcrResizeEdge {
  return OCR_RESIZE_EDGES.some((edge) => edge === value);
}

export function ocrPanelPhase(loading: boolean): OcrPanelPhase {
  return loading ? "loading" : "ready";
}

/** 加载中四项都关。成功或失败出面板后才开。 */
export function ocrPanelChrome(phase: OcrPanelPhase): OcrPanelChrome {
  const on = phase === "ready";
  return { drag: on, resize: on, font: on, enlarge: on };
}

export function createOcrPanelLayout(
  viewport: ViewportSize,
  contentHeight: number,
  insets?: OcrInsets,
): OcrPanelLayout {
  const limits = resolveLimits(viewport, insets);
  const natural = contentHeight > 0 ? contentHeight : Math.min(320, limits.maxH);
  const box = anchorBottomRight(OCR_PANEL_DEFAULT_WIDTH, Math.min(natural, limits.maxH), limits, false);
  return {
    sessionDefault: { ...box },
    box: { ...box },
    enlarged: false,
    fontPx: OCR_FONT_DEFAULT,
    moved: false,
  };
}

export function defaultOcrPanelWidth(viewport: ViewportSize, insets?: OcrInsets): number {
  const limits = resolveLimits(viewport, insets);
  return clamp(OCR_PANEL_DEFAULT_WIDTH, limits.minW, limits.maxW);
}

export function dragOcrPanel(
  layout: OcrPanelLayout,
  dx: number,
  dy: number,
  viewport: ViewportSize,
  insets?: OcrInsets,
): OcrPanelLayout {
  const limits = resolveLimits(viewport, insets);
  const box = clampBox(
    { ...layout.box, left: layout.box.left + dx, top: layout.box.top + dy },
    limits,
    false,
  );
  const moved = layout.moved || box.left !== layout.box.left || box.top !== layout.box.top;
  return { ...layout, box, moved };
}

export function resizeOcrPanel(
  layout: OcrPanelLayout,
  edge: OcrResizeEdge,
  dx: number,
  dy: number,
  viewport: ViewportSize,
  insets?: OcrInsets,
): OcrPanelLayout {
  const limits = resolveLimits(viewport, insets);
  const flags = edgeFlags(edge);
  const start = layout.box;
  let left = start.left;
  let top = start.top;
  let right = start.left + start.width;
  let bottom = start.top + start.height;
  if (flags.e) right += dx;
  if (flags.w) left += dx;
  if (flags.s) bottom += dy;
  if (flags.n) top += dy;

  left = clamp(left, limits.minX, limits.maxX);
  right = clamp(right, limits.minX, limits.maxX);
  top = clamp(top, limits.minY, limits.maxY);
  bottom = clamp(bottom, limits.minY, limits.maxY);
  ({ left, right } = fitSpan(left, right, limits.minW, limits.maxW, flags.w, flags.e, limits.minX, limits.maxX));
  ({ left: top, right: bottom } = fitSpan(top, bottom, limits.minH, limits.maxH, flags.n, flags.s, limits.minY, limits.maxY));

  const box = clampBox({ left, top, width: right - left, height: bottom - top }, limits, true);
  const moved = layout.moved || box.left !== start.left || box.top !== start.top;
  return { ...layout, box, moved };
}

export function stepOcrPanelFont(layout: OcrPanelLayout, direction: -1 | 1): OcrPanelLayout {
  const fontPx = clamp(layout.fontPx + direction * OCR_FONT_STEP, OCR_FONT_MIN, OCR_FONT_MAX);
  return { ...layout, fontPx };
}

/**
 * 放大：宽跳到约 560（视口留边），高回到本次打开时的默认高。
 * 还原：宽高都回到 sessionDefault，不回到中间拖动尺寸。
 * 字号不动。没拖过标题栏时仍贴右下角。
 */
export function toggleOcrPanelEnlarge(
  layout: OcrPanelLayout,
  viewport: ViewportSize,
  insets?: OcrInsets,
): OcrPanelLayout {
  const limits = resolveLimits(viewport, insets);
  if (layout.enlarged) {
    return {
      ...layout,
      enlarged: false,
      box: placeSize(layout, layout.sessionDefault.width, layout.sessionDefault.height, limits),
    };
  }
  return {
    ...layout,
    enlarged: true,
    box: placeSize(layout, OCR_PANEL_ENLARGED_WIDTH, layout.sessionDefault.height, limits),
  };
}

/** 视口变化时把当前窗钳回可见区域。不改字号，也不改 sessionDefault。 */
export function refitOcrPanel(
  layout: OcrPanelLayout,
  viewport: ViewportSize,
  insets?: OcrInsets,
): OcrPanelLayout {
  const limits = resolveLimits(viewport, insets);
  if (!layout.moved) {
    return { ...layout, box: anchorBottomRight(layout.box.width, layout.box.height, limits, false) };
  }
  return { ...layout, box: clampBox(layout.box, limits, false) };
}

export interface OcrPanelSession {
  current(): OcrPanelLayout | null;
  open(viewport: ViewportSize, contentHeight: number, insets?: OcrInsets): OcrPanelLayout;
  commit(layout: OcrPanelLayout): OcrPanelLayout;
  close(): void;
}

export function createOcrPanelSession(): OcrPanelSession {
  let layout: OcrPanelLayout | null = null;
  return {
    current: () => layout,
    open(viewport, contentHeight, insets) {
      layout = createOcrPanelLayout(viewport, contentHeight, insets);
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

export interface OcrPanelBlock {
  label: string;
  text: string;
  translated: boolean;
}

export interface OcrPanelModel {
  phase: OcrPanelPhase;
  title: string;
  iconUrl?: string;
  thumbSrc?: string;
  thumbLabel?: string;
  blocks?: OcrPanelBlock[];
  errorTitle?: string;
  error?: string;
  privacy?: string;
  sourceEnabled?: boolean;
  translationEnabled?: boolean;
  copySourceLabel?: string;
  copyTranslationLabel?: string;
  closeLabel?: string;
}

export interface OcrPanelController {
  getLayout(): OcrPanelLayout | null;
  viewport(): ViewportSize;
  insets?(): OcrInsets;
  onLayout(layout: OcrPanelLayout): void;
  onClose(): void;
  onCopySource?(button: HTMLButtonElement): void;
  onCopyTranslation?(button: HTMLButtonElement): void;
}

export interface OcrPanelMount {
  element: HTMLDivElement;
  apply(layout: OcrPanelLayout | null): void;
}

export function mountOcrPanel(
  document: Document,
  model: OcrPanelModel,
  controller: OcrPanelController,
): OcrPanelMount {
  const chrome = ocrPanelChrome(model.phase);
  const panel = el(document, "div", `ocr-panel ${model.phase}`);
  panel.dataset.phase = model.phase;

  const minus = chrome.font ? fontButton(document, "minus", "A−", "缩小字号") : null;
  const plus = chrome.font ? fontButton(document, "plus", "A+", "放大字号") : null;
  const zoom = chrome.enlarge ? el(document, "button", "zoom-btn", "放大") : null;
  if (zoom) {
    zoom.type = "button";
    zoom.title = "一键放大窗口（字号不变）";
    zoom.setAttribute("aria-label", zoom.title);
  }

  if (chrome.resize) {
    for (const edge of OCR_RESIZE_EDGES) {
      const handle = el(document, "span", `handle ${edge}`);
      handle.dataset.edge = edge;
      handle.setAttribute("aria-hidden", "true");
      handle.addEventListener("pointerdown", (event) => {
        const start = controller.getLayout();
        if (!start) return;
        event.stopPropagation();
        trackPointer(handle, event, (dx, dy) => {
          controller.onLayout(resizeOcrPanel(start, edge, dx, dy, controller.viewport(), controller.insets?.()));
        });
      });
      panel.append(handle);
    }
  }

  const head = el(document, "div", chrome.drag ? "ocr-hd ready" : "ocr-hd");
  if (chrome.drag) head.title = "拖动标题栏挪位置";
  const heading = el(document, "h2", undefined, model.title);
  const close = el(document, "button", "close", "×");
  close.type = "button";
  close.setAttribute("aria-label", model.closeLabel ?? "关闭");
  close.addEventListener("click", () => controller.onClose());
  head.append(icon(document, model.iconUrl, 22), heading);

  if (chrome.drag) {
    const hint = el(document, "span", "drag-hint");
    hint.setAttribute("aria-hidden", "true");
    hint.append(el(document, "span", "grip", "⠿"), document.createTextNode(" 拖动"));
    head.append(hint);
  }
  if (chrome.font && minus && plus) {
    const group = el(document, "div", "fs-ctrl");
    group.setAttribute("aria-label", "字号缩放");
    const range = el(document, "span", "fs-range", `${OCR_FONT_MIN}–${OCR_FONT_MAX}`);
    group.append(minus, range, plus);
    head.append(group);
    minus.addEventListener("click", (event) => {
      event.stopPropagation();
      const layout = controller.getLayout();
      if (!layout) return;
      const next = stepOcrPanelFont(layout, -1);
      controller.onLayout(next);
      apply(next);
    });
    plus.addEventListener("click", (event) => {
      event.stopPropagation();
      const layout = controller.getLayout();
      if (!layout) return;
      const next = stepOcrPanelFont(layout, 1);
      controller.onLayout(next);
      apply(next);
    });
  }
  if (zoom) {
    head.append(zoom);
    zoom.addEventListener("click", (event) => {
      event.stopPropagation();
      const layout = controller.getLayout();
      if (!layout) return;
      const next = toggleOcrPanelEnlarge(layout, controller.viewport(), controller.insets?.());
      controller.onLayout(next);
      apply(next);
    });
  }
  head.append(close);
  if (chrome.drag) {
    head.addEventListener("pointerdown", (event) => {
      if (controlTarget(event.target)) return;
      const start = controller.getLayout();
      if (!start) return;
      head.classList.add("dragging");
      trackPointer(head, event, (dx, dy) => {
        controller.onLayout(dragOcrPanel(start, dx, dy, controller.viewport(), controller.insets?.()));
      }, () => head.classList.remove("dragging"));
    });
  }

  const body = el(document, "div", model.phase === "loading" ? "ocr-body ocr-loading" : "ocr-body");
  if (model.phase === "loading") {
    const spinner = el(document, "div", "ocr-spinner");
    spinner.setAttribute("aria-hidden", "true");
    const status = el(document, "div", "status", "正在识字…");
    const hint = el(document, "div", "hint", "加载中固定位置与大小，不可拖改");
    body.append(spinner, status, hint);
  } else {
    if (model.thumbLabel) {
      const thumb = el(document, "div", "thumb");
      if (model.thumbSrc) {
        const image = document.createElement("img");
        image.alt = "";
        image.src = model.thumbSrc;
        thumb.append(image);
      }
      thumb.append(el(document, "span", undefined, model.thumbLabel));
      body.append(thumb);
    }
    for (const block of model.blocks ?? []) {
      const node = el(document, "div", block.translated ? "ocr-block trans" : "ocr-block");
      node.append(el(document, "div", "blabel", block.label), el(document, "div", "btext", block.text));
      body.append(node);
    }
    if (model.error) {
      const err = el(document, "div", "err");
      err.append(el(document, "strong", undefined, model.errorTitle || "识译失败"), document.createTextNode(model.error));
      body.append(err);
    }
    const actions = el(document, "div", "ocr-actions");
    const copySource = el(document, "button", "btn", model.copySourceLabel ?? "复制原文");
    copySource.type = "button";
    copySource.disabled = model.sourceEnabled !== true;
    copySource.addEventListener("click", () => controller.onCopySource?.(copySource));
    const copyTranslation = el(document, "button", "btn primary", model.copyTranslationLabel ?? "复制译文");
    copyTranslation.type = "button";
    copyTranslation.disabled = model.translationEnabled !== true;
    copyTranslation.addEventListener("click", () => controller.onCopyTranslation?.(copyTranslation));
    const dismiss = el(document, "button", "btn", "关闭");
    dismiss.type = "button";
    dismiss.addEventListener("click", () => controller.onClose());
    actions.append(copySource, copyTranslation, dismiss);
    body.append(actions);
    if (model.privacy) body.append(el(document, "p", "ocr-privacy", model.privacy));
  }

  panel.append(head, body);

  function apply(layout: OcrPanelLayout | null): void {
    if (!layout || model.phase !== "ready") return;
    panel.style.setProperty("--ocr-font", `${layout.fontPx}px`);
    panel.dataset.font = String(layout.fontPx);
    panel.dataset.enlarged = layout.enlarged ? "true" : "false";
    if (minus) minus.disabled = layout.fontPx <= OCR_FONT_MIN;
    if (plus) plus.disabled = layout.fontPx >= OCR_FONT_MAX;
    if (zoom) {
      const on = layout.enlarged;
      zoom.textContent = on ? "还原" : "放大";
      zoom.classList.toggle("on", on);
      zoom.title = on ? "还原窗口大小（字号不变）" : "一键放大窗口（字号不变）";
      zoom.setAttribute("aria-label", zoom.title);
    }
  }

  apply(controller.getLayout());
  return { element: panel, apply };
}

function placeSize(layout: OcrPanelLayout, width: number, height: number, limits: Limits): OcrPanelBox {
  if (!layout.moved) return anchorBottomRight(width, height, limits, false);
  return clampBox({ left: layout.box.left, top: layout.box.top, width, height }, limits, false);
}

function anchorBottomRight(width: number, height: number, limits: Limits, enforceMin: boolean): OcrPanelBox {
  const sized = clampBox({ left: limits.minX, top: limits.minY, width, height }, limits, enforceMin);
  return clampBox(
    {
      width: sized.width,
      height: sized.height,
      left: limits.maxX - sized.width,
      top: limits.maxY - sized.height,
    },
    limits,
    enforceMin,
  );
}

function resolveLimits(viewport: ViewportSize, insets?: OcrInsets): Limits {
  const pad = insets ?? defaultOcrInsets();
  const minX = pad.left;
  const minY = pad.top;
  const maxX = Math.max(pad.left + 1, viewport.width - pad.right);
  const maxY = Math.max(pad.top + 1, viewport.height - pad.bottom);
  const maxW = Math.max(1, maxX - minX);
  const maxH = Math.max(1, maxY - minY);
  return {
    minX,
    minY,
    maxX,
    maxY,
    maxW,
    maxH,
    minW: Math.min(OCR_PANEL_MIN_WIDTH, maxW),
    minH: Math.min(OCR_PANEL_MIN_HEIGHT, maxH),
  };
}

function clampBox(box: OcrPanelBox, limits: Limits, enforceMin: boolean): OcrPanelBox {
  const minW = enforceMin ? limits.minW : Math.min(limits.minW, box.width);
  const minH = enforceMin ? limits.minH : Math.min(limits.minH, box.height);
  const width = clamp(box.width, minW, limits.maxW);
  const height = clamp(box.height, minH, limits.maxH);
  const left = clamp(box.left, limits.minX, Math.max(limits.minX, limits.maxX - width));
  const top = clamp(box.top, limits.minY, Math.max(limits.minY, limits.maxY - height));
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function fitSpan(
  start: number,
  end: number,
  min: number,
  max: number,
  moveStart: boolean,
  moveEnd: boolean,
  limitStart: number,
  limitEnd: number,
): { left: number; right: number } {
  let from = start;
  let to = end;
  if (to - from < min) {
    if (moveStart && !moveEnd) from = to - min;
    else to = from + min;
  }
  if (to - from > max) {
    if (moveStart && !moveEnd) from = to - max;
    else to = from + max;
  }
  from = clamp(from, limitStart, limitEnd);
  to = clamp(to, limitStart, limitEnd);
  if (to - from < min && limitEnd - limitStart >= min) {
    if (moveStart && !moveEnd) from = clamp(to - min, limitStart, limitEnd);
    else to = clamp(from + min, limitStart, limitEnd);
  }
  return { left: from, right: to };
}

function edgeFlags(edge: OcrResizeEdge): { n: boolean; s: boolean; e: boolean; w: boolean } {
  return {
    n: edge === "n" || edge === "ne" || edge === "nw",
    s: edge === "s" || edge === "se" || edge === "sw",
    e: edge === "e" || edge === "ne" || edge === "se",
    w: edge === "w" || edge === "nw" || edge === "sw",
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function fontButton(document: Document, kind: "minus" | "plus", text: string, title: string): HTMLButtonElement {
  const button = el(document, "button", kind === "plus" ? "fs-btn plus" : "fs-btn minus", text);
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  return button;
}

function icon(document: Document, url: string | undefined, size: number): HTMLImageElement {
  const image = document.createElement("img");
  image.className = "ocr-logo";
  image.width = size;
  image.height = size;
  image.alt = "";
  image.draggable = false;
  if (url) image.src = url;
  return image;
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

function controlTarget(target: EventTarget | null): boolean {
  const node = target as { closest?: (selector: string) => unknown } | null;
  if (!node || typeof node.closest !== "function") return false;
  return Boolean(node.closest("button, .fs-ctrl"));
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
): void {
  const start = pointOf(event);
  if (start.button !== 0) return;
  const view = source.ownerDocument.defaultView;
  if (!view) return;
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
  event.preventDefault();
}
