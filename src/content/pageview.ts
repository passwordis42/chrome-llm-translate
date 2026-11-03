import { extractBlocks, PAGE_BLOCK_LIMIT, type PageBlock } from "../lib/extract.ts";
import { clearInsertedTranslations, inlineTarget, insertTranslationsBelow } from "../lib/inpage.ts";
import { pairLabel } from "../lib/languages.ts";
import type { Settings } from "../lib/settings.ts";
import { copyText, el, markImg, mount } from "./dom.ts";
import { requestTranslation, type StreamError } from "./session.ts";

export interface PageDeps {
  getSettings: () => Settings;
}

let deps: PageDeps | null = null;
let barHost: HTMLDivElement | null = null;
let metaNode: HTMLElement | null = null;
let outputs: HTMLElement[] = [];
let generation = 0;
let abort: AbortController | null = null;
let truncatedNote = false;

export function initPage(next: PageDeps): void {
  deps = next;
}

export function isInlinePageOpen(): boolean {
  return barHost != null || document.querySelector("[data-yifan-inline]") != null;
}

export function clearInlinePage(): void {
  generation += 1;
  abort?.abort();
  abort = null;
  outputs = [];
  truncatedNote = false;
  clearInsertedTranslations(document);
  barHost?.remove();
  barHost = null;
  metaNode = null;
}

export async function openInlinePage(): Promise<"empty" | "done"> {
  clearInlinePage();
  const token = generation;
  if (!deps) return "done";
  const extracted = extractBlocks(document);
  if (token !== generation) return "done";
  if (extracted.blocks.length === 0) return "empty";

  truncatedNote = extracted.truncated;
  const slots = insertTranslationsBelow(extracted.blocks);
  outputs = slots
    .map((slot) => inlineTarget(slot))
    .filter((node): node is HTMLElement => node != null);
  const byId = new Map(outputs.map((node) => [node.getAttribute("data-yifan-dst") ?? "", node]));
  const blocks = extracted.blocks.filter((block) => byId.has(block.id));
  if (token !== generation) {
    clearInlinePage();
    return "done";
  }
  if (blocks.length === 0) {
    clearInlinePage();
    return "empty";
  }
  renderBar(blocks.length);
  await translateAll(blocks, byId, token);
  return "done";
}

function renderBar(total: number): void {
  const settings = deps?.getSettings();
  const mounted = mount("yifan-inline-bar");
  barHost = mounted.host;
  mounted.host.setAttribute("role", "region");
  mounted.host.setAttribute("aria-label", "一翻整页译文");

  const toolbar = el("div", "toolbar inline-bar");
  const left = el("div", "left");
  const titles = el("div");
  metaNode = el("div", "meta", barStatus("run", 0, total));
  titles.append(el("h2", undefined, "一翻 · 整页 AI"), metaNode);
  left.append(markImg(28), titles);

  const right = el("div", "right");
  const chip = el("span", "chip", settings ? pairLabel(settings.sourceLang, settings.targetLang) : "自动 → 中文");
  const copyAll = el("button", "btn primary", "复制全部译文");
  copyAll.type = "button";
  copyAll.addEventListener("click", () => void onCopyAll(copyAll));
  const clear = el("button", "btn", "清除译文");
  clear.type = "button";
  clear.addEventListener("click", () => clearInlinePage());
  right.append(chip, copyAll, clear);
  toolbar.append(left, right);
  mounted.root.append(toolbar);
}

function barStatus(phase: "run" | "done" | "stop", index = 0, total = 0): string {
  const prefix = truncatedNote ? `只翻译前 ${PAGE_BLOCK_LIMIT} 段 · ` : "";
  if (phase === "run") return `${prefix}正在翻译 ${index + 1}/${total} · 译文在段落下`;
  if (phase === "stop") return `${prefix}翻译已停止 · 原文仍在原处`;
  return `${prefix}译文在段落下 · 原文保留`;
}

function setMeta(text: string, token: number): void {
  if (token !== generation || !metaNode?.isConnected) return;
  metaNode.textContent = text;
}

function setReady(dst: HTMLElement, text: string): void {
  dst.dataset.state = "ready";
  dst.style.color = "#1f2937";
  dst.textContent = text;
}

function setError(dst: HTMLElement, text: string): void {
  dst.dataset.state = "error";
  dst.style.color = "#b42318";
  dst.textContent = text;
}

async function translateAll(blocks: PageBlock[], byId: Map<string, HTMLElement>, token: number): Promise<void> {
  if (!deps) return;
  const controller = new AbortController();
  abort = controller;
  for (let index = 0; index < blocks.length; index += 1) {
    if (token !== generation || controller.signal.aborted) return;
    setMeta(barStatus("run", index, blocks.length), token);
    const block = blocks[index];
    const dst = byId.get(block.id);
    if (!dst) continue;
    const settings = deps.getSettings();
    try {
      await requestTranslation(
        block.text,
        { sourceLang: settings.sourceLang, targetLang: settings.targetLang },
        {
          signal: controller.signal,
          onText: (text) => {
            if (token !== generation || !text) return;
            setReady(dst, text);
          },
        },
      );
    } catch (error) {
      if (token !== generation || (error as Error).name === "AbortError") return;
      const streamError = error as StreamError;
      setError(dst, streamError.message || "翻译失败。不会假翻。");
      if (streamError.fatal !== false) {
        for (let rest = index + 1; rest < blocks.length; rest += 1) {
          const pending = byId.get(blocks[rest].id);
          if (!pending || pending.dataset.state === "ready") continue;
          setError(pending, "已停止。请先到设置检查 Key 或网络——不会假翻。");
        }
        setMeta(barStatus("stop"), token);
        return;
      }
    }
  }
  setMeta(barStatus("done"), token);
}

async function onCopyAll(button: HTMLButtonElement): Promise<void> {
  const parts = outputs
    .filter((node) => node.dataset.state === "ready" && node.textContent?.trim())
    .map((node) => node.textContent?.trim() ?? "");
  const previous = button.textContent;
  if (parts.length === 0) {
    button.textContent = "暂无译文";
  } else {
    const ok = await copyText(parts.join("\n\n"));
    button.textContent = ok ? "已复制" : "复制失败";
  }
  window.setTimeout(() => {
    if (button.isConnected) button.textContent = previous;
  }, 1200);
}
