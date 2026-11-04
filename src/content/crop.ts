import {
  CROP_PRIVACY,
  CROP_TIP,
  OCR_PANEL_TITLE,
  cropPixels,
  isCropLargeEnough,
  normalizeRect,
  type CssRect,
} from "../lib/ocr.ts";
import { copyText, el, markImg, mount } from "./dom.ts";

let session = 0;
let busy = false;
let cropHost: HTMLDivElement | null = null;
let panelHost: HTMLDivElement | null = null;

export function isOcrUiActive(): boolean {
  return busy || cropHost?.isConnected === true || panelHost?.isConnected === true;
}

export function isCropOpen(): boolean {
  return cropHost?.isConnected === true;
}

export function dismissOcrUi(): boolean {
  if (!isOcrUiActive()) return false;
  session += 1;
  busy = false;
  cropHost?.remove();
  panelHost?.remove();
  cropHost = null;
  panelHost = null;
  return true;
}

export function startCrop(): void {
  session += 1;
  const token = session;
  busy = false;
  cropHost?.remove();
  panelHost?.remove();
  cropHost = null;
  panelHost = null;
  renderCrop(token);
}

function renderCrop(token: number): void {
  const mounted = mount("yifan-crop");
  cropHost = mounted.host;
  mounted.host.setAttribute("role", "dialog");
  mounted.host.setAttribute("aria-label", "一翻框选识译");

  const layer = el("div", "crop-layer");
  const badge = el("div", "crop-badge");
  badge.append(markImg(16), document.createTextNode("一翻 · 框选识译"));
  const surface = el("div", "crop-surface");
  const selection = el("div", "crop-selection");
  selection.hidden = true;
  for (const corner of ["tl", "tr", "bl", "br"]) {
    selection.append(el("span", `handle ${corner}`));
  }
  surface.append(selection);
  const tip = el("div", "crop-tip");
  tip.append(document.createTextNode(`${CROP_TIP} · `), kbd("Esc"), document.createTextNode(" 取消"));
  const privacy = el("div", "crop-privacy", CROP_PRIVACY);
  liftAboveToolbar(tip, 28);
  liftAboveToolbar(privacy, 76);
  layer.append(badge, surface, tip, privacy);
  mounted.root.append(layer);

  let dragging = false;
  let startX = 0;
  let startY = 0;

  surface.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || token !== session) return;
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    surface.classList.add("armed");
    selection.hidden = false;
    placeSelection(selection, normalizeRect(startX, startY, startX, startY, viewport()));
    surface.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  surface.addEventListener("pointermove", (event) => {
    if (!dragging || token !== session) return;
    placeSelection(selection, normalizeRect(startX, startY, event.clientX, event.clientY, viewport()));
  });
  surface.addEventListener("pointerup", (event) => {
    if (!dragging || token !== session) return;
    dragging = false;
    const rect = normalizeRect(startX, startY, event.clientX, event.clientY, viewport());
    if (!isCropLargeEnough(rect)) {
      selection.hidden = true;
      surface.classList.remove("armed");
      return;
    }
    void finishCrop(token, rect);
  });
  surface.addEventListener("pointercancel", () => {
    dragging = false;
  });
}

async function finishCrop(token: number, rect: CssRect): Promise<void> {
  if (token !== session) return;
  busy = true;
  const view = viewport();
  cropHost?.remove();
  cropHost = null;
  await nextPaint();
  if (token !== session) {
    busy = false;
    return;
  }
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  try {
    const captured = (await chrome.runtime.sendMessage({ type: "capture-visible" })) as
      | { ok?: boolean; dataUrl?: string; message?: string }
      | undefined;
    if (token !== session) return;
    if (!captured?.ok || typeof captured.dataUrl !== "string") {
      showPanel(token, {
        width,
        height,
        errorTitle: "识译失败",
        error: captured?.message || "截不到当前页面。没有改动正文。不会假翻。",
      });
      return;
    }
    const cropped = await cropToJpeg(captured.dataUrl, rect, view);
    if (token !== session) return;
    showPanel(token, { width, height, thumb: cropped, loading: true });
    const result = (await chrome.runtime.sendMessage({ type: "ocr-translate", imageDataUrl: cropped })) as
      | { ok?: boolean; source?: string; translation?: string; title?: string; message?: string }
      | undefined;
    if (token !== session) return;
    if (result?.ok && result.source && result.translation) {
      showPanel(token, { width, height, thumb: cropped, source: result.source, translation: result.translation });
      return;
    }
    showPanel(token, {
      width,
      height,
      thumb: cropped,
      source: result?.source || "",
      errorTitle: result?.title || "识译失败",
      error: result?.message || "识译失败。不会假翻。页面正文没有改动。",
    });
  } catch {
    if (token !== session) return;
    showPanel(token, {
      width,
      height,
      errorTitle: "识译失败",
      error: "截图识译没有完成。不会假翻。页面正文没有改动。",
    });
  } finally {
    if (token === session) busy = false;
  }
}

function showPanel(
  token: number,
  state: {
    width: number;
    height: number;
    thumb?: string;
    loading?: boolean;
    source?: string;
    translation?: string;
    errorTitle?: string;
    error?: string;
  },
): void {
  if (token !== session) return;
  if (!panelHost?.isConnected) {
    const mounted = mount("yifan-ocr");
    panelHost = mounted.host;
    mounted.host.setAttribute("role", "dialog");
    mounted.host.setAttribute("aria-label", "截图识译结果");
    placePanel(mounted.host);
  }
  const root = panelHost.shadowRoot;
  if (!root) return;
  const existing = root.querySelector(".ocr-panel");
  existing?.remove();

  const panel = el("div", "ocr-panel");
  const head = el("div", "ocr-hd");
  const title = el("h2", undefined, OCR_PANEL_TITLE);
  const close = el("button", "close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "关闭");
  close.addEventListener("click", () => dismissOcrUi());
  head.append(markImg(22), title, close);

  const body = el("div", "ocr-body");
  const thumb = el("div", "thumb");
  if (state.thumb) {
    const image = document.createElement("img");
    image.alt = "";
    image.src = state.thumb;
    thumb.append(image);
  }
  thumb.append(el("span", undefined, `选区缩略 · ${state.width}×${state.height}`));
  body.append(thumb);

  const sourceText = state.source?.trim() ?? "";
  const translation = state.translation?.trim() ?? "";
  if (state.loading) {
    body.append(block("识别原文", "正在识字…", false));
    body.append(block("译文", "正在翻译…", true));
  } else if (state.error) {
    if (sourceText) body.append(block("识别原文", sourceText, false));
    const err = el("div", "err");
    err.append(el("strong", undefined, state.errorTitle || "识译失败"), document.createTextNode(state.error));
    body.append(err);
  } else {
    body.append(block("识别原文", sourceText, false));
    body.append(block("译文", translation, true));
  }

  const actions = el("div", "ocr-actions");
  const copySource = el("button", "btn", "复制原文");
  copySource.type = "button";
  copySource.disabled = !sourceText;
  copySource.addEventListener("click", () => void flashCopy(copySource, sourceText));
  const copyTranslation = el("button", "btn primary", "复制译文");
  copyTranslation.type = "button";
  copyTranslation.disabled = !translation;
  copyTranslation.addEventListener("click", () => void flashCopy(copyTranslation, translation));
  const dismiss = el("button", "btn", "关闭");
  dismiss.type = "button";
  dismiss.addEventListener("click", () => dismissOcrUi());
  actions.append(copySource, copyTranslation, dismiss);
  body.append(actions, el("p", "ocr-privacy", CROP_PRIVACY));
  panel.append(head, body);
  root.append(panel);
}

function block(label: string, text: string, translated: boolean): HTMLDivElement {
  const node = el("div", translated ? "ocr-block trans" : "ocr-block");
  node.append(el("div", "blabel", label), el("div", "btext", text));
  return node;
}

async function flashCopy(button: HTMLButtonElement, text: string): Promise<void> {
  if (!text) return;
  const previous = button.textContent;
  const ok = await copyText(text);
  button.textContent = ok ? "已复制" : "复制失败";
  window.setTimeout(() => {
    if (button.isConnected) button.textContent = previous;
  }, 1200);
}

function placeSelection(selection: HTMLElement, rect: CssRect): void {
  selection.style.left = `${rect.x}px`;
  selection.style.top = `${rect.y}px`;
  selection.style.width = `${rect.width}px`;
  selection.style.height = `${rect.height}px`;
}

function liftAboveToolbar(node: HTMLElement, bottom: number): void {
  const bar = document.getElementById("yifan-inline-bar");
  if (!bar) return;
  const height = bar.getBoundingClientRect().height;
  if (height > 0) node.style.bottom = `${bottom + Math.ceil(height) + 12}px`;
}

function placePanel(host: HTMLElement): void {
  const bar = document.getElementById("yifan-inline-bar");
  if (!bar) return;
  const height = bar.getBoundingClientRect().height;
  if (height > 0) host.style.bottom = `${Math.ceil(height) + 24}px`;
}

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

function kbd(text: string): HTMLElement {
  return el("kbd", undefined, text);
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(resolve, 50);
      });
    });
  });
}

async function cropToJpeg(fullDataUrl: string, rect: CssRect, view: { width: number; height: number }): Promise<string> {
  const image = await loadImage(fullDataUrl);
  const pixels = cropPixels(rect, { width: image.naturalWidth, height: image.naturalHeight }, view);
  if (!pixels) throw new Error("empty-crop");
  const longest = Math.max(pixels.sw, pixels.sh);
  const scale = Math.min(1, 1600 / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(pixels.sw * scale));
  canvas.height = Math.max(1, Math.round(pixels.sh * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no-canvas");
  context.drawImage(image, pixels.sx, pixels.sy, pixels.sw, pixels.sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image"));
    image.src = url;
  });
}
