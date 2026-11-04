import cssText from "./content.css";

const HOST_IDS = new Set([
  "yifan-float",
  "yifan-dialog",
  "yifan-inline-bar",
  "yifan-select-confirm",
  "yifan-crop",
  "yifan-ocr",
]);

export function mount(id: string): { host: HTMLDivElement; root: ShadowRoot } {
  document.getElementById(id)?.remove();
  const host = document.createElement("div");
  host.id = id;
  host.setAttribute("data-yifan-ignore", "");
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = cssText;
  root.append(style);
  (document.body ?? document.documentElement).append(host);
  return { host, root };
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function markImg(size: number): HTMLImageElement {
  const img = document.createElement("img");
  img.className = size > 20 ? "logo" : "mark";
  img.src = chrome.runtime.getURL("icons/icon128.png");
  img.width = size;
  img.height = size;
  img.alt = "";
  img.draggable = false;
  return img;
}

export function isYifanEvent(event: Event): boolean {
  return event.composedPath().some((node) => {
    if (!(node instanceof HTMLElement)) return false;
    return HOST_IDS.has(node.id);
  });
}

let scrollLocks = 0;
let previousOverflow = "";

export function lockPageScroll(): void {
  if (scrollLocks === 0) {
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
  }
  scrollLocks += 1;
}

export function unlockPageScroll(): void {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.documentElement.style.overflow = previousOverflow;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function selectionRect(): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0)) return null;
  return rect;
}
