import { PROTOCOL_ERROR_TEXT, INCOMPLETE_TEXT, swapDirection } from "../lib/direction.ts";
import { TARGET_LANGUAGES, SOURCE_LANGUAGES, languageByCode, shortLabel } from "../lib/languages.ts";
import type { Settings } from "../lib/settings.ts";
import { copyText, el, markImg, mount } from "./dom.ts";
import { detectionBook, directionOf, rememberDetection } from "./detect-state.ts";
import { requestTranslation, type StreamError } from "./session.ts";
import {
  SELECTION_FLOAT_ENLARGED_WIDTH_CSS,
  SELECTION_FLOAT_MAX_HEIGHT_CSS,
} from "../lib/selection-float.ts";

export interface InputFloatDeps {
  getSettings: () => Settings;
  persistDirection: (sourceLang: string, targetLang: string) => Promise<void>;
  onRestricted?: () => void;
}

let deps: InputFloatDeps | null = null;
let host: HTMLDivElement | null = null;
let root: ShadowRoot | null = null;
let field: HTMLTextAreaElement | null = null;
let output: HTMLElement | null = null;
let status: HTMLElement | null = null;
let copyButton: HTMLButtonElement | null = null;
let translateButton: HTMLButtonElement | null = null;
let chip: HTMLElement | null = null;
let hint: HTMLElement | null = null;
let pill: HTMLElement | null = null;
let swapButton: HTMLButtonElement | null = null;
let zoomButton: HTMLButtonElement | null = null;
let enlarged = false;
let busy = false;
let run = 0;
let currentAbort: AbortController | null = null;
let resultDirection: { sourceLang: string; targetLang: string } | null = null;

const INPUT_WIDTH = "min(400px, calc(100vw - 16px))";

export function initInputFloat(next: InputFloatDeps): void {
  deps = next;
}

export function isInputFloatOpen(): boolean {
  return host != null;
}

export function inputFloatText(): string {
  return field?.value ?? "";
}

export function openInputFloat(): void {
  ensure();
  if (!host || !field) return;
  host.hidden = false;
  renderChrome();
  field.focus();
}

export function closeInputFloat(): void {
  run += 1;
  host?.remove();
  host = null;
  root = null;
  field = null;
  busy = false;
}

export function cancelInputTranslation(): void {
  run += 1;
  currentAbort?.abort();
  currentAbort = null;
  busy = false;
  refreshInputFloat();
}

export function refreshInputFloat(): void {
  if (!host) return;
  renderChrome();
  markStaleIfNeeded();
}

function ensure(): void {
  if (host && root && field) return;
  const mounted = mount("yifan-input");
  host = mounted.host;
  root = mounted.root;
  enlarged = false;
  const tip = el("div", "input-panel");
  tip.setAttribute("role", "dialog");
  tip.setAttribute("aria-label", "一翻输入翻译");
  tip.addEventListener("mousedown", (event) => event.stopPropagation());

  const head = el("div", "input-hd");
  head.append(markImg(22), el("h2", undefined, "一翻 · 输入翻译"));
  const grip = el("span", "drag-hint");
  grip.append(el("span", "grip", "\u283F"), document.createTextNode(" 拖动"));
  zoomButton = el("button", "zoom-btn", "放大");
  zoomButton.type = "button";
  zoomButton.addEventListener("click", () => {
    enlarged = !enlarged;
    paintBox();
    renderChrome();
  });
  chip = el("span", "input-chip");
  const close = el("button", "input-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "关闭输入翻译");
  close.addEventListener("click", () => closeInputFloat());
  head.append(grip, zoomButton, chip, close);
  head.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) return;
    if (!host || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const originLeft = host.offsetLeft;
    const originTop = host.offsetTop;
    const move = (next: PointerEvent) => {
      if (!host) return;
      const maxLeft = Math.max(8, window.innerWidth - host.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - host.offsetHeight - 8);
      host.style.left = `${Math.min(maxLeft, Math.max(8, originLeft + next.clientX - startX))}px`;
      host.style.top = `${Math.min(maxTop, Math.max(8, originTop + next.clientY - startY))}px`;
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  });

  const body = el("div", "input-body");
  const card = el("div", "input-lang");
  card.append(el("div", "input-sec", "当前方向"));
  const row = el("div", "input-pair");
  const sourceField = el("label", "input-field");
  sourceField.append(el("span", undefined, "源语言"));
  const source = el("select");
  source.id = "yifan-input-source";
  sourceField.append(source);
  pill = el("span", "input-pill");
  pill.hidden = true;
  sourceField.append(pill);
  swapButton = el("button", "input-swap");
  swapButton.type = "button";
  swapButton.setAttribute("aria-label", "互换语言方向");
  swapButton.textContent = "⇄";
  const targetField = el("label", "input-field");
  targetField.append(el("span", undefined, "目标语言"));
  const target = el("select");
  target.id = "yifan-input-target";
  targetField.append(target);
  row.append(sourceField, swapButton, targetField);
  hint = el("p", "input-hint");
  hint.hidden = true;
  card.append(row, hint);
  field = el("textarea");
  field.placeholder = "输入或粘贴要翻译的文字";
  field.rows = 5;
  field.addEventListener("input", () => {
    const settings = deps?.getSettings();
    if (!settings || !field) return;
    detectionBook.invalidateText("input", "input", field.value);
    resultDirection = null;
    renderChrome();
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      void submit();
    }
  });
  status = el("p", "input-status");
  status.hidden = true;
  output = el("div", "input-out");
  output.hidden = true;
  body.append(card, field, status, output);

  const actions = el("div", "input-actions");
  copyButton = el("button", "btn", "复制译文");
  copyButton.type = "button";
  copyButton.hidden = true;
  copyButton.addEventListener("click", () => {
    const text = output?.querySelector(".btext")?.textContent?.trim() ?? "";
    if (text) void copyText(text);
  });
  translateButton = el("button", "btn primary", "翻译");
  translateButton.type = "button";
  translateButton.addEventListener("click", () => void submit());
  actions.append(copyButton, translateButton);
  const kbd = el("p", "input-kbd", "提交请点翻译，或按 Ctrl/⌘+Enter。打开、输入、粘贴或互换本身不会发送请求。");
  tip.append(head, body, actions, kbd);
  root.append(tip);

  source.addEventListener("change", () => {
    const settings = deps?.getSettings();
    if (!settings) return;
    void deps?.persistDirection(source.value, settings.targetLang);
  });
  target.addEventListener("change", () => {
    const settings = deps?.getSettings();
    if (!settings) return;
    void deps?.persistDirection(settings.sourceLang, target.value);
  });
  swapButton.addEventListener("click", () => {
    const settings = deps?.getSettings();
    if (!settings || !field) return;
    const direction = directionOf(settings);
    const code = detectionBook.usableCode(direction, "input", field.value);
    const next = swapDirection(direction, code);
    if (!next.ok) {
      renderChrome();
      return;
    }
    void deps?.persistDirection(next.sourceLang, next.targetLang);
  });

  for (const language of SOURCE_LANGUAGES) {
    const option = el("option", undefined, language.code === "auto" ? "自动识别" : language.label);
    option.value = language.code;
    source.append(option);
  }
  for (const language of TARGET_LANGUAGES) {
    const option = el("option", undefined, language.label);
    option.value = language.code;
    target.append(option);
  }
  host.style.left = "24px";
  host.style.top = "24px";
  paintBox();
}

function paintBox(): void {
  if (!host) return;
  host.classList.toggle("is-enlarged", enlarged);
  host.style.width = enlarged ? SELECTION_FLOAT_ENLARGED_WIDTH_CSS : INPUT_WIDTH;
  host.style.height = enlarged ? SELECTION_FLOAT_MAX_HEIGHT_CSS : "";
  host.style.maxHeight = enlarged ? SELECTION_FLOAT_MAX_HEIGHT_CSS : "calc(100vh - 24px)";
}

function renderChrome(): void {
  const settings = deps?.getSettings();
  if (!settings || !chip || !hint || !pill || !swapButton || !zoomButton) return;
  const direction = directionOf(settings);
  const text = field?.value ?? "";
  const code = detectionBook.usableCode(direction, "input", text);
  const left = settings.sourceLang === "auto"
    ? (code ? `自动识别 · ${languageByCode(code)?.short ?? code}` : "自动识别")
    : shortLabel(settings.sourceLang);
  chip.textContent = `${left} → ${shortLabel(settings.targetLang)}`;
  const source = root?.querySelector<HTMLSelectElement>("#yifan-input-source");
  const target = root?.querySelector<HTMLSelectElement>("#yifan-input-target");
  if (source) source.value = settings.sourceLang;
  if (target) target.value = settings.targetLang;
  if (code) {
    pill.hidden = false;
    pill.textContent = `已识别 · ${languageByCode(code)?.short ?? code}`;
  } else {
    pill.hidden = true;
    pill.textContent = "";
  }
  const message = settings.sourceLang === "auto" ? detectionBook.hint(direction, "input", text) : "";
  hint.hidden = !message;
  hint.textContent = message;
  const enabled = swapDirection(direction, code).ok;
  swapButton.disabled = !enabled;
  zoomButton.textContent = enlarged ? "还原" : "放大";
  zoomButton.classList.toggle("on", enlarged);
  if (translateButton) translateButton.disabled = busy;
}

function markStaleIfNeeded(): void {
  if (!output || !status || !deps) return;
  const settings = deps.getSettings();
  if (!resultDirection || output.hidden) return;
  const changed = resultDirection.sourceLang !== settings.sourceLang || resultDirection.targetLang !== settings.targetLang;
  const label = output.querySelector(".blabel");
  if (changed) {
    if (label) label.textContent = "译文（上一方向）";
    output.classList.add("is-stale");
    status.hidden = false;
    status.textContent = "方向已改变。这是上一方向的译文，没有自动重译。";
  }
}

async function submit(): Promise<void> {
  if (!deps || !field || !output || !status || !translateButton || !copyButton || busy) return;
  const text = field.value.trim();
  if (!text) return;
  const settings = deps.getSettings();
  const direction = directionOf(settings);
  const token = ++run;
  currentAbort?.abort();
  const controller = new AbortController();
  currentAbort = controller;
  const detectToken = detectionBook.begin("input", "input", field.value, direction);
  busy = true;
  resultDirection = null;
  output.hidden = true;
  output.replaceChildren();
  output.classList.remove("is-stale");
  copyButton.hidden = true;
  status.hidden = false;
  status.textContent = "正在翻译…";
  renderChrome();
  let partial = "";
  try {
    const detected = await requestTranslation(text, direction, {
      signal: controller.signal,
      onText: (next) => {
        if (token !== run) return;
        partial = next;
        showBody(next, false);
      },
    });
    if (token !== run) {
      detectionBook.drop(detectToken);
      return;
    }
    showBody(partial, false);
    resultDirection = direction;
    status.hidden = true;
    rememberDetection(field.value, direction, detectToken, detected.detection, detected.code);
  } catch (error) {
    if (token !== run) return;
    detectionBook.drop(detectToken);
    const streamError = error as StreamError;
    const protocol = streamError.message?.includes("协议错误") === true;
    if (streamError.name === "AbortError" && partial) {
      showBody(partial, true);
      status.hidden = false;
      status.textContent = INCOMPLETE_TEXT;
    } else if (protocol) {
      output.hidden = true;
      output.replaceChildren();
      copyButton.hidden = true;
      status.hidden = false;
      status.textContent = PROTOCOL_ERROR_TEXT;
    } else if (streamError.name !== "AbortError") {
      output.hidden = true;
      output.replaceChildren();
      copyButton.hidden = true;
      status.hidden = false;
      status.textContent = streamError.message || "翻译失败。原文已保留。不会假翻。";
    }
  } finally {
    if (token === run) {
      busy = false;
      renderChrome();
    }
  }
}

function showBody(text: string, incomplete: boolean): void {
  if (!output || !copyButton) return;
  output.hidden = false;
  output.classList.toggle("is-stale", incomplete);
  output.replaceChildren();
  const label = el("div", "blabel", incomplete ? "译文（未完成）" : "译文");
  const body = el("div", "btext", text);
  output.append(label, body);
  copyButton.hidden = !text.trim();
}
