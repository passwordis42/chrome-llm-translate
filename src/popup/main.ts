import { CROP_OCR_COMMAND, PAGE_TRANSLATE_COMMAND } from "../lib/commands.ts";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES, isSourceLang, isTargetLang } from "../lib/languages.ts";
import type { PageControlStatus, PageRunState } from "../lib/inpage.ts";
import type { GlossaryEntry } from "../lib/glossary.ts";
import type { ToPageMessage } from "../lib/messages.ts";
import {
  DEFAULT_MODEL,
  STORAGE_KEY,
  isCuratedModel,
  normalizeSettings,
  readSettings,
  resolveModelChoice,
  writeSettings,
  type SelectionMode,
  type Settings,
} from "../lib/settings.ts";

const homeView = document.querySelector<HTMLElement>("#home-view");
const settingsView = document.querySelector<HTMLElement>("#settings-view");
const glossaryView = document.querySelector<HTMLElement>("#glossary-view");
const pageStatus = document.querySelector<HTMLElement>("#page-status");
const statusLabel = document.querySelector<HTMLElement>("#status-label");
const statusHint = document.querySelector<HTMLElement>("#status-hint");
const progress = document.querySelector<HTMLElement>("#progress");
const progressBar = document.querySelector<HTMLElement>("#progress-bar");
const startButton = document.querySelector<HTMLButtonElement>("#start-page");
const stopButton = document.querySelector<HTMLButtonElement>("#stop-page");
const clearButton = document.querySelector<HTMLButtonElement>("#clear-page");
const backHome = document.querySelector<HTMLButtonElement>("#back-home");
const keyInput = document.querySelector<HTMLInputElement>("#api-key");
const modelSelect = document.querySelector<HTMLSelectElement>("#model");
const customModel = document.querySelector<HTMLInputElement>("#custom-model");
const sourceSelect = document.querySelector<HTMLSelectElement>("#source-lang");
const targetSelect = document.querySelector<HTMLSelectElement>("#target-lang");
const modeConfirm = document.querySelector<HTMLButtonElement>("#mode-confirm");
const modeImmediate = document.querySelector<HTMLButtonElement>("#mode-immediate");
const gestureToggle = document.querySelector<HTMLButtonElement>("#gesture-toggle");
const homeSelection = document.querySelector<HTMLButtonElement>("#home-selection-toggle");
const homeForce = document.querySelector<HTMLButtonElement>("#home-force-select");
const hotkeyPage = document.querySelector<HTMLElement>("#hotkey-page");
const hotkeyCrop = document.querySelector<HTMLElement>("#hotkey-crop");
const ocrButton = document.querySelector<HTMLButtonElement>("#screenshot-ocr");
const ocrNote = document.querySelector<HTMLElement>("#ocr-note");
const err = document.querySelector<HTMLElement>("#err");
const errTitle = document.querySelector<HTMLElement>("#err-title");
const errBody = document.querySelector<HTMLElement>("#err-body");
const ok = document.querySelector<HTMLElement>("#ok");
const okTitle = document.querySelector<HTMLElement>("#ok-title");
const okBody = document.querySelector<HTMLElement>("#ok-body");
const testButton = document.querySelector<HTMLButtonElement>("#test");
const saveButton = document.querySelector<HTMLButtonElement>("#save");
const rows = document.querySelector<HTMLElement>("#glossary-rows");
const termSource = document.querySelector<HTMLInputElement>("#term-source");
const termTarget = document.querySelector<HTMLInputElement>("#term-target");
const glossaryError = document.querySelector<HTMLElement>("#glossary-error");

if (
  !homeView || !settingsView || !glossaryView || !pageStatus || !statusLabel || !statusHint || !progress || !progressBar ||
  !startButton || !stopButton || !clearButton || !backHome ||
  !keyInput || !modelSelect || !customModel || !sourceSelect || !targetSelect ||
  !modeConfirm || !modeImmediate || !gestureToggle || !err || !errTitle || !errBody || !ok || !okTitle || !okBody ||
  !testButton || !saveButton || !rows || !termSource || !termTarget || !glossaryError ||
  !homeSelection || !homeForce || !hotkeyPage || !hotkeyCrop || !ocrButton || !ocrNote
) {
  throw new Error("设置页结构不完整");
}

const ui = {
  homeView, settingsView, glossaryView, pageStatus, statusLabel, statusHint, progress, progressBar,
  startButton, stopButton, clearButton, backHome,
  keyInput, modelSelect, customModel, sourceSelect, targetSelect,
  modeConfirm, modeImmediate, gestureToggle, err, errTitle, errBody, ok, okTitle, okBody, testButton, saveButton,
  rows, termSource, termTarget, glossaryError,
  homeSelection, homeForce, hotkeyPage, hotkeyCrop, ocrButton, ocrNote,
};

fillSelect(ui.sourceSelect, SOURCE_LANGUAGES);
fillSelect(ui.targetSelect, TARGET_LANGUAGES);

let openedAsTab = false;
let glossaryFrom: "home" | "settings" = "settings";

if (window.innerWidth > 520) document.body.classList.add("is-tab");
chrome.tabs.getCurrent((tab) => {
  const inTab = Boolean(tab);
  openedAsTab = inTab;
  document.body.classList.toggle("is-tab", inTab);
  if (inTab) showSettings();
  else {
    showHome();
    startPoll();
  }
});

document.querySelector("#open-settings")?.addEventListener("click", () => showSettings());
document.querySelector("#settings-link")?.addEventListener("click", () => showSettings());
ui.backHome.addEventListener("click", () => {
  showHome();
  startPoll();
});
ui.startButton.addEventListener("click", () => void runCommand("page-ai-start"));
ui.stopButton.addEventListener("click", () => void runCommand("page-ai-stop"));
ui.clearButton.addEventListener("click", () => void runCommand("page-ai-clear"));
ui.ocrButton.addEventListener("click", () => void startCropFromPopup());

let queue = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task, task);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

void readSettings().then((settings) => applySettings(settings)).catch(() => showError("连接失败", "读不到本地设置。"));

ui.keyInput.addEventListener("input", () => clearBanners());
ui.modelSelect.addEventListener("change", () => {
  ui.customModel.value = "";
  clearBanners();
});
ui.customModel.addEventListener("input", () => clearBanners());
bindSwitch(ui.homeSelection, (next) => {
  applySelectionSwitch(next);
  void patchSettings({ selectionEnabled: next });
});
bindSwitch(ui.homeForce, (next) => {
  applyForceSelectSwitch(next);
  void patchSettings({ forceSelectEnabled: next });
});
bindSwitch(ui.gestureToggle, (next) => {
  applyGestureSwitch(next);
  void patchSettings({ gestureEnabled: next });
});
ui.modeConfirm.addEventListener("click", () => persistMode("confirm"));
ui.modeImmediate.addEventListener("click", () => persistMode("immediate"));
bindLang(ui.sourceSelect, "sourceLang");
bindLang(ui.targetSelect, "targetLang");

document.querySelector("#home-open-glossary")?.addEventListener("click", () => openGlossary("home"));
void renderHotkeys();
document.querySelector("#close-glossary")?.addEventListener("click", () => closeGlossary());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  applyShortcuts(normalizeSettings(changes[STORAGE_KEY].newValue));
});

ui.testButton.addEventListener("click", () => void testConnection());
ui.saveButton.addEventListener("click", () => void saveForm());
document.querySelector("#add-term")?.addEventListener("click", () => void addTerm());
ui.termTarget.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void addTerm();
  }
});
ui.keyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void saveForm();
  }
});
ui.rows.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const id = target.dataset.id;
  if (!id || !target.classList.contains("del")) return;
  void enqueue(async () => {
    const current = await readSettings();
    await writeSettings({ ...current, glossary: current.glossary.filter((entry) => entry.id !== id) });
    renderGlossary((await readSettings()).glossary);
  });
});

function showSettings(): void {
  ui.homeView.hidden = true;
  ui.glossaryView.hidden = true;
  ui.settingsView.hidden = false;
}

function showHome(): void {
  ui.settingsView.hidden = true;
  ui.glossaryView.hidden = true;
  ui.homeView.hidden = false;
  void refreshStatus();
}

let polling = false;

function startPoll(): void {
  if (polling) return;
  polling = true;
  window.setInterval(() => {
    if (!ui.homeView.hidden) void refreshStatus();
  }, 400);
}

function fillSelect(select: HTMLSelectElement, options: ReadonlyArray<{ code: string; label: string }>): void {
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.code;
    node.textContent = option.label;
    select.append(node);
  }
}

function applySettings(settings: Settings): void {
  ui.keyInput.value = settings.apiKey;
  if (isCuratedModel(settings.model)) {
    ui.modelSelect.value = settings.model;
    ui.customModel.value = "";
  } else {
    ui.modelSelect.value = DEFAULT_MODEL;
    ui.customModel.value = settings.model;
  }
  applyShortcuts(settings);
}

function applyShortcuts(settings: Settings): void {
  ui.sourceSelect.value = settings.sourceLang;
  ui.targetSelect.value = settings.targetLang;
  applySelectionSwitch(settings.selectionEnabled);
  applyForceSelectSwitch(settings.forceSelectEnabled);
  applyGestureSwitch(settings.gestureEnabled);
  applyMode(settings.selectionMode);
  renderGlossary(settings.glossary);
}

function applySelectionSwitch(on: boolean): void {
  ui.homeSelection.setAttribute("aria-checked", on ? "true" : "false");
  ui.homeSelection.setAttribute("aria-label", on ? "划词翻译已开启" : "划词翻译已关闭");
}

function applyForceSelectSwitch(on: boolean): void {
  const label = on ? "允许划选被禁文字，已开启" : "允许划选被禁文字，已关闭";
  ui.homeForce.setAttribute("aria-checked", on ? "true" : "false");
  ui.homeForce.setAttribute("aria-label", label);
}

function applyGestureSwitch(on: boolean): void {
  ui.gestureToggle.setAttribute("aria-checked", on ? "true" : "false");
  ui.gestureToggle.setAttribute("aria-label", on ? "启用鼠标手势，已开启" : "启用鼠标手势，已关闭");
}

function applyMode(mode: SelectionMode): void {
  ui.modeConfirm.setAttribute("aria-pressed", mode === "confirm" ? "true" : "false");
  ui.modeImmediate.setAttribute("aria-pressed", mode === "immediate" ? "true" : "false");
}

function currentMode(): SelectionMode {
  return ui.modeImmediate.getAttribute("aria-pressed") === "true" ? "immediate" : "confirm";
}

function bindSwitch(button: HTMLButtonElement, persist: (next: boolean) => void): void {
  button.addEventListener("click", () => {
    persist(button.getAttribute("aria-checked") !== "true");
  });
}

function bindLang(select: HTMLSelectElement, key: "sourceLang" | "targetLang"): void {
  select.addEventListener("change", () => {
    const value = select.value;
    void patchSettings(key === "targetLang"
      ? (isTargetLang(value) ? { targetLang: value } : {})
      : (isSourceLang(value) ? { sourceLang: value } : {}));
  });
}

function patchSettings(patch: Partial<Settings>): Promise<void> {
  if (Object.keys(patch).length === 0) return Promise.resolve();
  return enqueue(async () => {
    const current = await readSettings();
    await writeSettings({ ...current, ...patch });
  });
}

function openGlossary(from: "home" | "settings"): void {
  glossaryFrom = from;
  ui.homeView.hidden = true;
  ui.settingsView.hidden = true;
  ui.glossaryView.hidden = false;
}

function closeGlossary(): void {
  ui.glossaryView.hidden = true;
  if (glossaryFrom === "home") showHome();
  else showSettings();
}

function persistMode(mode: SelectionMode): void {
  applyMode(mode);
  clearBanners();
  void enqueue(async () => {
    const current = await readSettings();
    await writeSettings({ ...current, selectionMode: mode });
  });
}

function chosenModel(): ReturnType<typeof resolveModelChoice> {
  return resolveModelChoice(ui.modelSelect.value, ui.customModel.value);
}

function renderGlossary(entries: GlossaryEntry[]): void {
  ui.rows.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement("tr");
    const source = document.createElement("td");
    source.className = "src";
    source.textContent = entry.source;
    const target = document.createElement("td");
    target.className = "dst";
    target.textContent = entry.target;
    const action = document.createElement("td");
    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.dataset.id = entry.id;
    del.textContent = "删";
    action.append(del);
    row.append(source, target, action);
    ui.rows.append(row);
  }
}

async function saveForm(): Promise<void> {
  ui.saveButton.disabled = true;
  try {
    const choice = chosenModel();
    if (!choice.ok) {
      showError("连接失败", choice.message);
      return;
    }
    await enqueue(async () => {
      const current = await readSettings();
      const targetLang = isTargetLang(ui.targetSelect.value) ? ui.targetSelect.value : current.targetLang;
      await writeSettings({
        ...current,
        apiKey: ui.keyInput.value.trim(),
        model: choice.model,
        sourceLang: ui.sourceSelect.value,
        targetLang,
        selectionEnabled: current.selectionEnabled,
        selectionMode: currentMode(),
        forceSelectEnabled: current.forceSelectEnabled,
        gestureEnabled: ui.gestureToggle.getAttribute("aria-checked") === "true",
        glossary: current.glossary,
      });
    });
    showOk("已保存", "Key 与设置已留在本机。");
  } catch {
    showError("连接失败", "设置没有写入本机。请重试。");
  } finally {
    ui.saveButton.disabled = false;
  }
}

async function testConnection(): Promise<void> {
  const apiKey = ui.keyInput.value.trim();
  const choice = chosenModel();
  if (!choice.ok) {
    showError("连接失败", choice.message);
    return;
  }
  if (!apiKey) {
    showError("连接失败", "请先填写 API Key。不会假翻。");
    return;
  }
  ui.testButton.disabled = true;
  ui.testButton.textContent = "测试中…";
  clearBanners();
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "test-connection",
      apiKey,
      model: choice.model,
    })) as { ok?: boolean; title?: string; message?: string } | undefined;
    if (response?.ok) showOk("连接成功", "千问已响应。若刚改过 Key 或模型，请再点保存。");
    else showError(response?.title || "连接失败", response?.message || "API Key 无效或网络不可达。请检查后重试——不会假翻。");
  } catch {
    showError("连接失败", "API Key 无效或网络不可达。请检查后重试——不会假翻。");
  } finally {
    ui.testButton.disabled = false;
    ui.testButton.textContent = "测试连接";
  }
}

async function addTerm(): Promise<void> {
  const source = ui.termSource.value.trim();
  const target = ui.termTarget.value.trim();
  ui.glossaryError.hidden = true;
  if (!source || !target) {
    ui.glossaryError.hidden = false;
    ui.glossaryError.textContent = "请同时填写原文和固定译法。";
    return;
  }
  await enqueue(async () => {
    const current = await readSettings();
    const duplicate = current.glossary.some((entry) => entry.source.toLowerCase() === source.toLowerCase());
    if (duplicate) {
      ui.glossaryError.hidden = false;
      ui.glossaryError.textContent = "这条原文已在术语本中。";
      return;
    }
    const entry: GlossaryEntry = { id: crypto.randomUUID(), source, target };
    await writeSettings({ ...current, glossary: [...current.glossary, entry] });
    ui.termSource.value = "";
    ui.termTarget.value = "";
    renderGlossary((await readSettings()).glossary);
  });
}

function showError(title: string, message: string): void {
  ui.ok.hidden = true;
  ui.err.hidden = false;
  ui.errTitle.textContent = title;
  ui.errBody.textContent = message;
}

function showOk(title: string, message: string): void {
  ui.err.hidden = true;
  ui.ok.hidden = false;
  ui.okTitle.textContent = title;
  ui.okBody.textContent = message;
}

function clearBanners(): void {
  ui.err.hidden = true;
  ui.ok.hidden = true;
}

async function renderHotkeys(): Promise<void> {
  if (!chrome.commands?.getAll) return;
  try {
    const commands = await chrome.commands.getAll();
    const page = commands.find((item) => item.name === PAGE_TRANSLATE_COMMAND)?.shortcut;
    const crop = commands.find((item) => item.name === CROP_OCR_COMMAND)?.shortcut;
    ui.hotkeyPage.textContent = page || "未设置";
    ui.hotkeyCrop.textContent = crop || "未设置";
  } catch {
    // 静态文案就是建议键 Alt+T / Alt+S。
  }
}

type PageCommand = "page-ai-start" | "page-ai-stop" | "page-ai-clear" | "page-ai-status";

const PAGE_STATES = new Set<PageRunState>(["idle", "running", "stopped", "done"]);

function unavailable(hint: string): PageControlStatus {
  return {
    ok: true,
    state: "idle",
    label: "当前页 · 不可用",
    hint,
    canStart: false,
    canStop: false,
    canClear: false,
    startLabel: "开始",
    progress: null,
  };
}

function isPageStatus(value: unknown): value is PageControlStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<PageControlStatus>;
  return status.ok === true
    && typeof status.state === "string"
    && PAGE_STATES.has(status.state)
    && typeof status.label === "string"
    && typeof status.hint === "string"
    && typeof status.canStart === "boolean"
    && typeof status.canStop === "boolean"
    && typeof status.canClear === "boolean"
    && (status.startLabel === "开始" || status.startLabel === "继续");
}

function isWebTab(tab: chrome.tabs.Tab | undefined): tab is chrome.tabs.Tab & { id: number } {
  if (!tab || tab.id == null || !tab.url) return false;
  return tab.url.startsWith("http://") || tab.url.startsWith("https://");
}

function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.getCurrent((tab) => resolve(tab));
  });
}

async function activeWebTab(): Promise<(chrome.tabs.Tab & { id: number }) | null> {
  const here = await currentTab();
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (isWebTab(current) && current.id !== here?.id) return current;
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (isWebTab(focused) && focused.id !== here?.id) return focused;
  const tabs = await chrome.tabs.query({ active: true });
  const found = tabs.find((tab) => isWebTab(tab) && tab.id !== here?.id);
  return found && isWebTab(found) ? found : null;
}

async function deliver(tabId: number, message: ToPageMessage): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

let refreshing = false;

async function refreshStatus(): Promise<void> {
  if (refreshing || ui.homeView.hidden) return;
  refreshing = true;
  try {
    await sendPage("page-ai-status");
  } finally {
    refreshing = false;
  }
}

async function startCropFromPopup(): Promise<void> {
  ui.ocrNote.hidden = true;
  const tab = await activeWebTab();
  if (!tab) {
    ui.ocrNote.hidden = false;
    ui.ocrNote.textContent = "当前没有可截图的网页。没有改动正文。";
    return;
  }
  try {
    await deliver(tab.id, { type: "start-crop-ocr" });
    if (!openedAsTab) window.close();
  } catch {
    ui.ocrNote.hidden = false;
    ui.ocrNote.textContent = "这个页面不能截图识译。打开普通网页后再试。没有改动正文。";
  }
}

async function runCommand(type: Exclude<PageCommand, "page-ai-status">): Promise<void> {
  ui.startButton.disabled = true;
  ui.stopButton.disabled = true;
  ui.clearButton.disabled = true;
  await sendPage(type);
}

async function sendPage(type: PageCommand): Promise<void> {
  const tab = await activeWebTab();
  if (!tab) {
    renderStatus(unavailable("当前没有可翻译的网页。"));
    return;
  }
  try {
    const response = await deliver(tab.id, { type });
    if (isPageStatus(response)) renderStatus(response);
    else renderStatus(unavailable("这个页面没有回应。打开普通网页后再试。"));
  } catch {
    renderStatus(unavailable("这个页面不能整页翻译。打开普通网页后再试。"));
  }
}

function renderStatus(status: PageControlStatus): void {
  ui.pageStatus.dataset.state = status.state;
  ui.statusLabel.textContent = status.label;
  ui.statusHint.textContent = status.hint;
  ui.startButton.textContent = status.startLabel;
  ui.startButton.disabled = !status.canStart;
  ui.stopButton.disabled = !status.canStop;
  ui.stopButton.classList.toggle("stop", status.canStop);
  ui.clearButton.disabled = !status.canClear;
  const showProgress = status.state === "running";
  ui.progress.hidden = !showProgress;
  if (showProgress) {
    const ratio = status.progress ?? 0;
    const pct = Math.max(8, Math.round(ratio * 100));
    ui.progressBar.style.width = `${pct}%`;
    ui.progress.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  }
}
