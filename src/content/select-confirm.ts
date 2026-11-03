import { computeFloatPosition } from "../lib/layout.ts";
import { cleanSelection, selectionPreview } from "../lib/selection.ts";
import { el, markImg, mount, selectionRect } from "./dom.ts";

let host: HTMLDivElement | null = null;
let activeText = "";

export function isSelectConfirmOpen(): boolean {
  return host != null;
}

export function currentSelectConfirmText(): string {
  return host ? activeText : "";
}

export function closeSelectConfirm(): void {
  host?.remove();
  host = null;
  activeText = "";
}

export function openSelectConfirm(text: string, onTranslate: (text: string) => void): void {
  const source = cleanSelection(text);
  const preview = selectionPreview(source);
  if (!preview) return;
  closeSelectConfirm();
  const mounted = mount("yifan-select-confirm");
  host = mounted.host;
  activeText = source;

  const card = el("div", "confirm-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "一翻划词确认");

  const head = el("div", "confirm-hd");
  const brand = el("span", "brand-mini");
  brand.append(markImg(16), el("span", undefined, "一翻 · 确认翻译"));
  const close = el("button", "close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "关闭确认条");
  close.addEventListener("click", () => closeSelectConfirm());
  head.append(brand, close);

  const previewNode = el("div", "preview", preview);
  previewNode.title = preview;

  const actions = el("div", "actions");
  const ok = el("button", "btn primary", "翻译");
  ok.type = "button";
  const cancel = el("button", "btn", "取消");
  cancel.type = "button";
  ok.addEventListener("click", () => {
    const value = activeText;
    closeSelectConfirm();
    onTranslate(value);
  });
  cancel.addEventListener("click", () => closeSelectConfirm());
  actions.append(ok, cancel);

  card.append(head, previewNode, actions);
  card.addEventListener("mousedown", (event) => event.stopPropagation());
  mounted.root.append(card);
  repositionSelectConfirm();
  requestAnimationFrame(() => repositionSelectConfirm());
}

export function repositionSelectConfirm(): void {
  if (!host) return;
  const rect = selectionRect();
  const pos = computeFloatPosition({
    rect: rect
      ? { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
      : null,
    card: { width: host.offsetWidth || 360, height: host.offsetHeight || 124 },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });
  host.style.left = `${Math.round(pos.left)}px`;
  host.style.top = `${Math.round(pos.top)}px`;
}
