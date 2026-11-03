import { extractBlocks, type PageBlock } from "../lib/extract.ts";
import { pairLabel } from "../lib/languages.ts";
import type { Settings } from "../lib/settings.ts";
import { copyText, el, lockPageScroll, markImg, mount, unlockPageScroll } from "./dom.ts";
import { requestTranslation, type StreamError } from "./session.ts";

export interface PageDeps {
  getSettings: () => Settings;
}

let deps: PageDeps | null = null;
let host: HTMLDivElement | null = null;
let generation = 0;
let abort: AbortController | null = null;
let locked = false;

export function initPage(next: PageDeps): void {
  deps = next;
}

export function isSideBySideOpen(): boolean {
  return host != null;
}

export function closeSideBySide(): void {
  generation += 1;
  abort?.abort();
  abort = null;
  host?.remove();
  host = null;
  if (locked) {
    unlockPageScroll();
    locked = false;
  }
}

export async function openSideBySide(): Promise<void> {
  closeSideBySide();
  const token = generation;
  const extracted = extractBlocks(document);
  if (token !== generation) return;
  const { root } = render(extracted);
  if (extracted.blocks.length === 0) return;
  await translateAll(extracted.blocks, root, token);
}

function render(extracted: ReturnType<typeof extractBlocks>): { root: ShadowRoot } {
  const mounted = mount("yifan-page");
  host = mounted.host;
  lockPageScroll();
  locked = true;
  const settings = deps?.getSettings();
  const stage = el("div", "stage");
  const wrap = el("div", "wrap");
  const toolbar = el("div", "toolbar");
  const left = el("div", "left");
  const titles = el("div");
  titles.append(el("h2", undefined, "一翻 · 整页 AI"), el("div", "meta", "文内并排双语 · 不替换原文"));
  left.append(markImg(28), titles);

  const right = el("div", "right");
  const chip = el("span", "chip", settings ? pairLabel(settings.sourceLang, settings.targetLang) : "自动 → 中文");
  const copyAll = el("button", "btn primary", "复制全部译文");
  copyAll.type = "button";
  copyAll.addEventListener("click", () => void onCopyAll(mounted.root, copyAll));
  const exit = el("button", "btn", "退出对照");
  exit.type = "button";
  exit.addEventListener("click", () => closeSideBySide());
  right.append(chip, copyAll, exit);
  toolbar.append(left, right);

  const page = el("div", "page");
  page.append(el("div", "badge", "整页 AI 对照阅读"));
  page.append(el("h1", undefined, extracted.title));
  const list = el("div");
  list.id = "yifan-blocks";
  if (extracted.blocks.length === 0) {
    const empty = el("div", "block");
    empty.append(el("div", "dst bad", "这一页没有找到可翻译的段落。没有改动原文。"));
    list.append(empty);
  }
  for (const block of extracted.blocks) {
    list.append(blockView(block));
  }
  const note = el("p", "note", "说明：进入网页不自动全翻；整页 AI 与整页谷歌都要二次确认。");
  page.append(list, note);
  if (extracted.truncated) {
    page.append(el("p", "note", "这一页较长，只翻译了前 60 段。"));
  }
  wrap.append(toolbar, page);
  stage.append(wrap);
  mounted.root.append(stage);
  return { root: mounted.root };
}

function blockView(block: PageBlock): HTMLElement {
  const row = el("div", "block");
  row.dataset.id = block.id;
  const sourceCol = el("div");
  sourceCol.append(el("div", "tag", "原文"), el("div", "src", block.text));
  const targetCol = el("div");
  const dst = el("div", "dst");
  dst.dataset.id = block.id;
  targetCol.append(el("div", "tag", "译文"), dst);
  row.append(sourceCol, targetCol);
  return row;
}

async function translateAll(blocks: PageBlock[], root: ShadowRoot, token: number): Promise<void> {
  if (!deps) return;
  const controller = new AbortController();
  abort = controller;
  const meta = root.querySelector(".meta");
  for (let index = 0; index < blocks.length; index += 1) {
    if (token !== generation || controller.signal.aborted) return;
    if (meta) meta.textContent = `正在翻译 ${index + 1}/${blocks.length} · 不替换原文`;
    const block = blocks[index];
    const dst = root.querySelector<HTMLElement>(`.dst[data-id="${block.id}"]`);
    if (!dst) continue;
    dst.classList.add("live");
    const settings = deps.getSettings();
    try {
      await requestTranslation(
        block.text,
        { sourceLang: settings.sourceLang, targetLang: settings.targetLang },
        {
          signal: controller.signal,
          onText: (text) => {
            if (token !== generation) return;
            dst.textContent = text;
          },
        },
      );
      dst.classList.remove("live");
    } catch (error) {
      dst.classList.remove("live");
      if (token !== generation || (error as Error).name === "AbortError") return;
      const streamError = error as StreamError;
      dst.classList.add("bad");
      dst.textContent = streamError.message || "翻译失败。不会假翻。";
      if (streamError.fatal !== false) {
        for (let rest = index + 1; rest < blocks.length; rest += 1) {
          const pending = root.querySelector<HTMLElement>(`.dst[data-id="${blocks[rest].id}"]`);
          if (!pending) continue;
          pending.classList.add("bad");
          pending.textContent = "已停止。请先到设置检查 Key 或网络——不会假翻。";
        }
        if (meta) meta.textContent = "文内并排双语 · 翻译已停止";
        return;
      }
    }
  }
  if (token === generation && meta) meta.textContent = "文内并排双语 · 不替换原文";
}

async function onCopyAll(root: ShadowRoot, button: HTMLButtonElement): Promise<void> {
  const parts = [...root.querySelectorAll<HTMLElement>(".dst")]
    .filter((node) => !node.classList.contains("bad") && node.textContent?.trim())
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
