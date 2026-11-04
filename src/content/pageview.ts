import { extractBlocks, type PageBlock } from "../lib/extract.ts";
import {
  PAGE_BATCH_LIMIT,
  SCROLL_HINT,
  TOOLBAR_META,
  collectReplacedText,
  derivePageStatus,
  ensureSnapshot,
  isInViewport,
  nextVisibleBatch,
  releaseUnfinished,
  replaceInPlace,
  restoreSnapshots,
  startKind,
  toolbarChip,
  type PageControlStatus,
  type TextSnapshot,
} from "../lib/inpage.ts";
import { pairLabel } from "../lib/languages.ts";
import type { Settings } from "../lib/settings.ts";
import { copyText, el, markImg, mount } from "./dom.ts";
import { requestTranslation, type StreamError } from "./session.ts";

export interface PageDeps {
  getSettings: () => Settings;
}

let deps: PageDeps | null = null;
let barHost: HTMLDivElement | null = null;
let hintNode: HTMLElement | null = null;
let statusNode: HTMLElement | null = null;
let generation = 0;
let abort: AbortController | null = null;
let observer: IntersectionObserver | null = null;
let pumpTimer = 0;
let onViewportChange: (() => void) | null = null;
let pumpAgain = false;
let stopped = false;
let lastError = "";
let tracked: PageBlock[] = [];
let seen = new Set<string>();
let done = new Set<string>();
let queued = new Set<string>();
let partials = new Map<string, string>();
let snapshots = new Map<Element, TextSnapshot>();
let activePump: Promise<void> | null = null;
let releasePump: (() => void) | null = null;
let stopButton: HTMLButtonElement | null = null;
let chipNode: HTMLElement | null = null;
let pairText = "自动 → 中文";
const anchorIds = new WeakMap<Element, string>();
let anchorSeq = 0;
let idSeq = 0;

export function initPage(next: PageDeps): void {
  deps = next;
}

export function isInlinePageOpen(): boolean {
  return barHost != null;
}

export function pageStatus(): PageControlStatus {
  const open = barHost != null;
  const pending = open && tracked.some((block) => !done.has(block.id));
  return derivePageStatus({
    open,
    stopped,
    pending,
    doneCount: done.size,
    totalCount: tracked.length,
    error: lastError,
  });
}

export function stopInlinePage(): void {
  if (!barHost || stopped) return;
  stopped = true;
  lastError = "";
  abort?.abort();
  abort = null;
  releaseUnfinished(queued, done);
  const token = generation;
  setStatus("", token, "idle");
  setHint(tracked.some((block) => !done.has(block.id)), token);
}

export function clearInlinePage(): void {
  generation += 1;
  abort?.abort();
  abort = null;
  unbindViewport();
  restoreSnapshots([...snapshots.values()]);
  snapshots.clear();
  tracked = [];
  seen.clear();
  done.clear();
  queued.clear();
  partials.clear();
  stopped = false;
  pumpAgain = false;
  lastError = "";
  idSeq = 0;
  barHost?.remove();
  barHost = null;
  hintNode = null;
  statusNode = null;
  stopButton = null;
  chipNode = null;
}

export async function startInlinePage(): Promise<"empty" | "started" | "busy"> {
  const kind = startKind(pageStatus().state);
  if (kind === "busy") return "busy";
  if (kind === "resume") {
    resumeInlinePage();
    return "started";
  }
  const previous = activePump;
  clearInlinePage();
  const token = generation;
  if (previous) await previous;
  if (token !== generation || !deps) return "started";
  syncFromDocument();
  if (token !== generation) return "started";
  if (tracked.length === 0) return "empty";
  abort = new AbortController();
  stopped = false;
  lastError = "";
  renderBar(tracked[0]?.text ?? "");
  bindViewport(token);
  void pump(token);
  return "started";
}

function resumeInlinePage(): void {
  const token = generation;
  stopped = false;
  lastError = "";
  abort?.abort();
  abort = new AbortController();
  releaseUnfinished(queued, done);
  if (!onViewportChange) bindViewport(token);
  setStatus("", token, "idle");
  setHint(tracked.some((block) => !done.has(block.id)), token);
  void pump(token);
}

function anchorKey(anchor: Element): string {
  let key = anchorIds.get(anchor);
  if (!key) {
    anchorSeq += 1;
    key = `a${anchorSeq}`;
    anchorIds.set(anchor, key);
  }
  return key;
}

function syncFromDocument(): void {
  const extracted = extractBlocks(document, Number.POSITIVE_INFINITY);
  const partIndex = new Map<Element, number>();
  let added = false;
  for (const block of extracted.blocks) {
    const index = partIndex.get(block.anchor) ?? 0;
    partIndex.set(block.anchor, index + 1);
    const key = `${anchorKey(block.anchor)}#${index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tracked.push({ id: `b${idSeq}`, text: block.text, anchor: block.anchor });
    idSeq += 1;
    observer?.observe(block.anchor);
    added = true;
  }
  if (!added) return;
  tracked.sort((left, right) => {
    if (left.anchor === right.anchor) return 0;
    const position = left.anchor.compareDocumentPosition(right.anchor);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

function elementVisible(anchor: Element): boolean {
  const view = anchor.ownerDocument?.defaultView;
  if (!view) return false;
  if (typeof anchor.getBoundingClientRect !== "function") return false;
  try {
    const rect = anchor.getBoundingClientRect();
    return isInViewport(rect, { width: view.innerWidth, height: view.innerHeight });
  } catch {
    return false;
  }
}

function bindViewport(token: number): void {
  onViewportChange = () => {
    if (token !== generation || stopped) return;
    schedulePump(token);
  };
  document.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);
  if (typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver((entries) => {
      if (token !== generation || stopped) return;
      if (!entries.some((entry) => entry.isIntersecting)) return;
      schedulePump(token);
    });
    for (const block of tracked) observer.observe(block.anchor);
  }
}

function unbindViewport(): void {
  if (onViewportChange) {
    document.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange);
    onViewportChange = null;
  }
  observer?.disconnect();
  observer = null;
  window.clearTimeout(pumpTimer);
  pumpTimer = 0;
}

function schedulePump(token: number): void {
  window.clearTimeout(pumpTimer);
  pumpTimer = window.setTimeout(() => {
    void pump(token);
  }, 150);
}

async function pump(token: number): Promise<void> {
  if (token !== generation || stopped || !abort) return;
  if (activePump) {
    pumpAgain = true;
    return;
  }
  activePump = new Promise((resolve) => {
    releasePump = resolve;
  });
  try {
    syncFromDocument();
    while (token === generation && !stopped) {
      const batch = nextVisibleBatch(tracked, {
        limit: PAGE_BATCH_LIMIT,
        done,
        queued,
        isVisible: elementVisible,
      });
      if (batch.length === 0) {
        const pending = tracked.some((block) => !done.has(block.id));
        setHint(pending, token);
        if (!stopped) {
          if (lastError) setStatus(lastError, token, "error");
          else setStatus(pending ? "" : "本页可译段落已替换。", token, "idle");
        }
        break;
      }
      for (const block of batch) queued.add(block.id);
      setHint(true, token);
      await translateBatch(batch, token);
      syncFromDocument();
    }
  } finally {
    const release = releasePump;
    releasePump = null;
    activePump = null;
    release?.();
    if (token === generation) {
      const pending = tracked.some((block) => !done.has(block.id));
      setHint(pending, token);
    }
    if (token === generation && pumpAgain && !stopped) {
      pumpAgain = false;
      void pump(token);
    }
  }
}

async function translateBatch(batch: readonly PageBlock[], token: number): Promise<void> {
  if (!deps || !abort) return;
  const signal = abort.signal;
  for (let index = 0; index < batch.length; index += 1) {
    if (token !== generation || signal.aborted || stopped) return;
    const block = batch[index];
    if (!block) continue;
    setStatus(`正在翻译可见区 ${index + 1}/${batch.length}`, token, "run");
    const settings = deps.getSettings();
    try {
      await requestTranslation(
        block.text,
        { sourceLang: settings.sourceLang, targetLang: settings.targetLang },
        {
          signal,
          onText: (text) => {
            if (token !== generation || !text) return;
            partials.set(block.id, text);
            paintAnchor(block.anchor);
          },
        },
      );
      done.add(block.id);
      queued.delete(block.id);
    } catch (error) {
      queued.delete(block.id);
      if (token !== generation || signal.aborted || (error as Error).name === "AbortError") return;
      done.add(block.id);
      const streamError = error as StreamError;
      lastError = streamError.message || "翻译失败。不会假翻。";
      setStatus(lastError, token, "error");
      if (streamError.fatal !== false) {
        stopped = true;
        releaseUnfinished(queued, done);
        setHint(tracked.some((item) => !done.has(item.id)), token);
        return;
      }
    }
  }
}

function paintAnchor(anchor: Element): void {
  const snapshot = ensureSnapshot(snapshots, anchor);
  if (!snapshot) return;
  const text = tracked
    .filter((block) => block.anchor === anchor)
    .map((block) => partials.get(block.id) ?? "")
    .filter((part) => part.trim().length > 0)
    .map((part) => part.trim())
    .join("\n\n");
  if (!text) return;
  replaceInPlace(snapshot, text);
}

function renderBar(sample: string): void {
  const settings = deps?.getSettings();
  const mounted = mount("yifan-inline-bar");
  barHost = mounted.host;
  mounted.host.setAttribute("role", "region");
  mounted.host.setAttribute("aria-label", "一翻整页 AI");

  const toolbar = el("div", "toolbar inline-bar");
  const left = el("div", "left");
  const titles = el("div");
  titles.append(el("h2", undefined, "一翻 · 整页 AI"), el("div", "meta", TOOLBAR_META));
  left.append(markImg(28), titles);

  const right = el("div", "right");
  pairText = settings ? pairLabel(settings.sourceLang, settings.targetLang, sample) : "自动 → 中文";
  const chip = el("span", "chip", pairText);
  chipNode = chip;
  const stop = el("button", "btn stop", "停止");
  stop.type = "button";
  stop.addEventListener("click", () => stopInlinePage());
  stopButton = stop;
  const copyAll = el("button", "btn", "复制全部译文");
  copyAll.type = "button";
  copyAll.addEventListener("click", () => void onCopyAll(copyAll));
  const clear = el("button", "btn", "清除译文");
  clear.type = "button";
  clear.addEventListener("click", () => clearInlinePage());
  right.append(chip, stop, copyAll, clear);
  toolbar.append(left, right);

  hintNode = el("p", "hint", SCROLL_HINT);
  statusNode = el("p", "status");
  statusNode.hidden = true;
  mounted.root.append(toolbar, hintNode, statusNode);
  paintChrome(generation);
}

function setHint(pending: boolean, token: number): void {
  if (token !== generation || !hintNode?.isConnected) return;
  const status = pageStatus();
  if (status.state === "running" && pending) {
    hintNode.hidden = false;
    hintNode.textContent = SCROLL_HINT;
  } else if (status.state === "stopped" || status.state === "done") {
    hintNode.hidden = false;
    hintNode.textContent = status.hint;
  } else {
    hintNode.hidden = true;
  }
  paintChrome(token);
}

function setStatus(text: string, token: number, state: "run" | "idle" | "error"): void {
  if (token !== generation || !statusNode?.isConnected) return;
  statusNode.hidden = text.length === 0;
  statusNode.dataset.state = state;
  statusNode.textContent = text;
  paintChrome(token);
}

function paintChrome(token: number): void {
  if (token !== generation || !barHost) return;
  const status = pageStatus();
  const chip = toolbarChip(status.state, pairText);
  if (chipNode?.isConnected) {
    chipNode.textContent = chip.text;
    chipNode.classList.toggle("live", chip.live);
  }
  if (stopButton?.isConnected) stopButton.hidden = !status.canStop;
}

async function onCopyAll(button: HTMLButtonElement): Promise<void> {
  const parts = collectReplacedText(tracked.map((block) => block.anchor));
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
