import { pairLabel, TARGET_LANGUAGES } from "../lib/languages.ts";
import { classifySelection, cleanSelection } from "../lib/selection.ts";
import type { Settings } from "../lib/settings.ts";
import { copyText, el, markImg, mount, selectionRect } from "./dom.ts";
import { computeFloatPosition } from "../lib/layout.ts";
import { requestTranslation, type StreamError } from "./session.ts";
import {
  SELECTION_FLOAT_DEFAULT_WIDTH_CSS,
  SELECTION_FLOAT_ENLARGED_WIDTH_CSS,
  SELECTION_FLOAT_FONT_PX,
  SELECTION_FLOAT_MAX_HEIGHT_CSS,
  createSelectionFloatSession,
  mountSelectionFloatShell,
  noteSelectionFloatContent,
  placeSelectionFloat,
  selectionFloatRenderedSize,
  type SelectionFloatLayout,
  type SelectionFloatShell,
} from "../lib/selection-float.ts";

export interface FloatDeps {
  getSettings: () => Settings;
  persistTarget: (lang: string) => Promise<void>;
  openSettings: () => void;
}

let deps: FloatDeps | null = null;
let host: HTMLDivElement | null = null;
let root: ShadowRoot | null = null;
let shell: SelectionFloatShell | null = null;
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
const session = createSelectionFloatSession();

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
  shell = null;
  session.close();
  activeText = "";
}

/** 滚动或视口变化：没拖过才回到选区旁，拖过只保证仍在视口内。 */
export function repositionFloat(): void {
  const current = session.current();
  if (!host || !current) return;
  const draft = { ...current, contentHeight: measureContentHeight() };
  const anchor = draft.moved ? null : selectionAnchor(draft);
  paint(session.commit(placeSelectionFloat(draft, anchor, currentViewport())));
}

export function openSelectionFloat(text: string): void {
  const cleaned = cleanSelection(text);
  if (classifySelection(cleaned) === "empty") return;
  ensure();
  if (!srcNode || !dstNode || !langNode || !host) return;
  session.close();
  activeText = cleaned;
  srcNode.textContent = cleaned;
  langRow?.setAttribute("hidden", "");
  refreshLang();
  clearError();
  dstNode.textContent = "";
  dstNode.classList.add("live");
  setActions("translate");
  host.hidden = false;
  host.classList.remove("is-enlarged");
  const contentHeight = measureContentHeight();
  const draft: SelectionFloatLayout = {
    left: 0,
    top: 0,
    enlarged: false,
    moved: false,
    contentHeight,
  };
  const anchor = selectionAnchor(draft);
  paint(session.commit(placeSelectionFloat(session.open(anchor, contentHeight), anchor, currentViewport())));
  requestAnimationFrame(() => repositionFloat());
  if (classifySelection(cleaned) === "too_long") {
    showError("翻译失败", "选区超过 5000 字，请缩短后再翻。不会假翻。", "local");
    return;
  }
  void translate();
}

function ensure(): void {
  if (host && root && shell) return;
  const mounted = mount("yifan-float");
  host = mounted.host;
  root = mounted.root;
  const brand = el("span", "brand-mini");
  brand.append(markImg(16), el("span", undefined, "一翻 · 划词"));
  shell = mountSelectionFloatShell(document, {
    getLayout: () => session.current(),
    viewport: currentViewport,
    contentHeight: measureContentHeight,
    anchor: selectionAnchor,
    onLayout: (next) => {
      if (!host || !session.current()) return;
      paint(session.commit(next));
    },
    onClose: () => closeSelectionFloat(),
  }, brand);
  langNode = shell.lang;

  srcNode = el("div", "src");
  dstNode = el("div", "dst");
  dstNode.setAttribute("aria-live", "polite");
  errNode = el("div", "err");
  errNode.setAttribute("role", "alert");
  errNode.hidden = true;
  errTitle = el("strong");
  errBody = el("span");
  errNode.append(errTitle, errBody);
  shell.pair.append(srcNode, dstNode, errNode);

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
  shell.tip.append(langRow, actions);
  root.append(shell.tip);
}

function currentViewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

function selectionAnchor(layout: SelectionFloatLayout): { left: number; top: number } {
  const viewport = currentViewport();
  const rect = selectionRect();
  return computeFloatPosition({
    rect: rect
      ? { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
      : null,
    card: selectionFloatRenderedSize(layout, viewport),
    viewport,
  });
}

function measureContentHeight(): number {
  if (!root) return 0;
  const pair = root.querySelector<HTMLElement>(".pair");
  const head = root.querySelector<HTMLElement>(".tip-hd");
  const lang = root.querySelector<HTMLElement>(".lang-row");
  const bar = root.querySelector<HTMLElement>(".actions");
  if (!pair || !head || !bar) return 0;
  const langHeight = lang && !lang.hidden ? lang.offsetHeight : 0;
  return pair.scrollHeight + head.offsetHeight + langHeight + bar.offsetHeight + 2;
}

/** 正文变高时只按当前档位钳进视口，不重新贴选区。 */
function syncContentBounds(): void {
  const current = session.current();
  if (!host || !current) return;
  paint(session.commit(noteSelectionFloatContent(current, measureContentHeight(), currentViewport())));
}

function paint(layout: SelectionFloatLayout): void {
  if (!host) return;
  host.classList.toggle("is-enlarged", layout.enlarged);
  host.dataset.enlarged = layout.enlarged ? "true" : "false";
  host.dataset.moved = layout.moved ? "true" : "false";
  host.dataset.font = String(SELECTION_FLOAT_FONT_PX);
  host.style.left = `${layout.left}px`;
  host.style.top = `${layout.top}px`;
  host.style.width = layout.enlarged ? SELECTION_FLOAT_ENLARGED_WIDTH_CSS : SELECTION_FLOAT_DEFAULT_WIDTH_CSS;
  host.style.height = layout.enlarged ? SELECTION_FLOAT_MAX_HEIGHT_CSS : "";
  host.style.maxHeight = SELECTION_FLOAT_MAX_HEIGHT_CSS;
  shell?.apply(layout);
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
          syncContentBounds();
        },
      },
    );
    if (token !== runId || !dstNode) return;
    dstNode.classList.remove("live");
    syncContentBounds();
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
    syncContentBounds();
    return;
  }
  if (mode === "error") {
    actions.append(
      button("打开设置", "primary", "settings", () => deps?.openSettings()),
      button("重试", "", "retry", () => void translate()),
      button("关闭", "", "close", () => closeSelectionFloat()),
    );
    syncContentBounds();
    return;
  }
  actions.append(button("关闭", "", "close", () => closeSelectionFloat()));
  syncContentBounds();
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
