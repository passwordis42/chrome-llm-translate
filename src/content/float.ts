import { pairLabel, TARGET_LANGUAGES } from "../lib/languages.ts";
import { classifySelection, cleanSelection } from "../lib/selection.ts";
import type { Settings } from "../lib/settings.ts";
import { copyText, el, markImg, mount, selectionRect } from "./dom.ts";
import { computeFloatPosition } from "../lib/layout.ts";
import { requestTranslation, type StreamError } from "./session.ts";

export interface FloatDeps {
  getSettings: () => Settings;
  persistTarget: (lang: string) => Promise<void>;
  openSettings: () => void;
}

let deps: FloatDeps | null = null;
let host: HTMLDivElement | null = null;
let root: ShadowRoot | null = null;
let srcNode: HTMLElement | null = null;
let dstNode: HTMLElement | null = null;
let errNode: HTMLElement | null = null;
let errTitle: HTMLElement | null = null;
let errBody: HTMLElement | null = null;
let langNode: HTMLElement | null = null;
let langRow: HTMLElement | null = null;
let actions: HTMLElement | null = null;
let activeText = "";
let abort: AbortController | null = null;
let runId = 0;

export function initFloat(next: FloatDeps): void {
  deps = next;
}

export function isFloatOpen(): boolean {
  return host != null;
}

export function currentFloatText(): string {
  return host ? activeText : "";
}

export function closeSelectionFloat(): void {
  runId += 1;
  abort?.abort();
  abort = null;
  host?.remove();
  host = null;
  root = null;
  activeText = "";
}

export function repositionFloat(): void {
  if (!host) return;
  const rect = selectionRect();
  const pos = computeFloatPosition({
    rect: rect
      ? { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
      : null,
    card: { width: host.offsetWidth || 380, height: host.offsetHeight || 180 },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });
  host.style.left = `${Math.round(pos.left)}px`;
  host.style.top = `${Math.round(pos.top)}px`;
}

export function openSelectionFloat(text: string): void {
  const cleaned = cleanSelection(text);
  if (classifySelection(cleaned) === "empty") return;
  ensure();
  if (!srcNode || !dstNode || !langNode) return;
  activeText = cleaned;
  srcNode.textContent = cleaned;
  langRow?.setAttribute("hidden", "");
  refreshLang();
  clearError();
  dstNode.textContent = "";
  dstNode.classList.add("live");
  setActions("translate");
  if (host) host.hidden = false;
  repositionFloat();
  requestAnimationFrame(() => repositionFloat());
  if (classifySelection(cleaned) === "too_long") {
    showError("翻译失败", "选区超过 5000 字，请缩短后再翻。不会假翻。", "local");
    return;
  }
  void translate();
}

function ensure(): void {
  if (host && root) return;
  const mounted = mount("yifan-float");
  host = mounted.host;
  root = mounted.root;
  const tip = el("div", "tip");
  tip.setAttribute("role", "dialog");
  tip.setAttribute("aria-label", "一翻划词浮层");

  const head = el("div", "tip-hd");
  const brand = el("span", "brand-mini");
  brand.append(markImg(16), el("span", undefined, "一翻 · 划词"));
  langNode = el("span", "lang");
  head.append(brand, langNode);

  const pair = el("div", "pair");
  srcNode = el("div", "src");
  dstNode = el("div", "dst");
  dstNode.setAttribute("aria-live", "polite");
  errNode = el("div", "err");
  errNode.setAttribute("role", "alert");
  errNode.hidden = true;
  errTitle = el("strong");
  errBody = el("span");
  errNode.append(errTitle, errBody);
  pair.append(srcNode, dstNode, errNode);

  langRow = el("div", "lang-row");
  langRow.hidden = true;
  const label = el("label", undefined, "目标语言");
  label.htmlFor = "yifan-target";
  const select = el("select");
  select.id = "yifan-target";
  select.setAttribute("aria-label", "目标语言");
  for (const language of TARGET_LANGUAGES) {
    const option = el("option", undefined, language.label);
    option.value = language.code;
    select.append(option);
  }
  select.addEventListener("change", () => {
    void deps?.persistTarget(select.value).then(() => {
      refreshLang();
      void translate();
    });
  });
  langRow.append(label, select);

  actions = el("div", "actions");
  tip.append(head, pair, langRow, actions);
  root.append(tip);
  tip.addEventListener("mousedown", (event) => event.stopPropagation());
}

function refreshLang(): void {
  if (!langNode || !deps) return;
  const settings = deps.getSettings();
  langNode.textContent = pairLabel(settings.sourceLang, settings.targetLang, activeText);
  const select = root?.querySelector("select");
  if (select) select.value = settings.targetLang;
}

async function translate(): Promise<void> {
  if (!deps || !dstNode) return;
  const token = ++runId;
  abort?.abort();
  const controller = new AbortController();
  abort = controller;
  const settings = deps.getSettings();
  clearError();
  dstNode.textContent = "";
  dstNode.classList.add("live");
  setActions("translate");
  refreshLang();
  try {
    await requestTranslation(
      activeText,
      { sourceLang: settings.sourceLang, targetLang: settings.targetLang },
      {
        signal: controller.signal,
        onText: (text) => {
          if (token !== runId || !dstNode) return;
          dstNode.textContent = text;
          const copy = actions?.querySelector<HTMLButtonElement>("[data-act='copy']");
          if (copy) copy.disabled = !text.trim();
        },
      },
    );
    if (token !== runId || !dstNode) return;
    dstNode.classList.remove("live");
  } catch (error) {
    if (token !== runId) return;
    if ((error as Error).name === "AbortError") return;
    dstNode?.classList.remove("live");
    const streamError = error as StreamError;
    showError(streamError.title || "翻译失败", streamError.message || "翻译失败。不会假翻。", "remote");
  }
}

function clearError(): void {
  if (!errNode || !dstNode) return;
  errNode.hidden = true;
  dstNode.hidden = false;
}

function showError(title: string, message: string, kind: "remote" | "local"): void {
  if (!errNode || !errTitle || !errBody || !dstNode) return;
  dstNode.classList.remove("live");
  dstNode.hidden = true;
  dstNode.textContent = "";
  errTitle.textContent = title;
  errBody.textContent = message;
  errNode.hidden = false;
  setActions(kind === "remote" ? "error" : "local");
}

function setActions(mode: "translate" | "error" | "local"): void {
  if (!actions) return;
  actions.replaceChildren();
  if (mode === "translate") {
    actions.append(
      button("复制译文", "primary", "copy", () => void onCopy(), !dstNode?.textContent?.trim()),
      button("改语言", "", "lang", () => langRow?.toggleAttribute("hidden")),
      button("关闭", "", "close", () => closeSelectionFloat()),
    );
    return;
  }
  if (mode === "error") {
    actions.append(
      button("打开设置", "primary", "settings", () => deps?.openSettings()),
      button("重试", "", "retry", () => void translate()),
      button("关闭", "", "close", () => closeSelectionFloat()),
    );
    return;
  }
  actions.append(button("关闭", "", "close", () => closeSelectionFloat()));
}

function button(label: string, variant: string, act: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const node = el("button", variant ? `btn ${variant}` : "btn", label);
  node.type = "button";
  node.dataset.act = act;
  node.disabled = disabled;
  node.addEventListener("click", onClick);
  return node;
}

async function onCopy(): Promise<void> {
  const text = dstNode?.textContent?.trim() ?? "";
  if (!text) return;
  const ok = await copyText(text);
  const copy = actions?.querySelector<HTMLButtonElement>("[data-act='copy']");
  if (!copy) return;
  const previous = copy.textContent;
  copy.textContent = ok ? "已复制" : "复制失败";
  window.setTimeout(() => {
    if (copy.isConnected) copy.textContent = previous;
  }, 1200);
}
