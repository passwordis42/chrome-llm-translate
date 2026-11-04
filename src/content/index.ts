import { dismissConfirm, isConfirmOpen, showConfirm, showNotice } from "./confirm.ts";
import { dismissOcrUi, isOcrUiActive, startCrop } from "./crop.ts";
import { isYifanEvent } from "./dom.ts";
import { closeSelectionFloat, currentFloatText, initFloat, isFloatOpen, openSelectionFloat, repositionFloat } from "./float.ts";
import { mountPageGesture } from "./gesture.ts";
import { clearInlinePage, initPage, isInlinePageOpen, pageStatus, startInlinePage, stopInlinePage, syncToolbarPair } from "./pageview.ts";
import { closeSelectConfirm, currentSelectConfirmText, isSelectConfirmOpen, openSelectConfirm, repositionSelectConfirm } from "./select-confirm.ts";
import { missingKeyNotice, type ShortcutAction } from "../lib/commands.ts";
import { createShortcutGate, matchShortcut } from "../lib/shortcuts.ts";
import type { PageControlStatus } from "../lib/inpage.ts";
import type { ToPageMessage } from "../lib/messages.ts";
import { cleanSelection, selectionOffer } from "../lib/selection.ts";
import { createForceSelect } from "../lib/force-select.ts";
import { NO_VISION_OCR_MESSAGE, providerSupportsVision } from "../lib/providers.ts";
import { STORAGE_KEY, defaultSettings, normalizeSettings, readSettings, writeSettings } from "../lib/settings.ts";
import { isTargetLang } from "../lib/languages.ts";
import { showSelectionToast } from "./toast.ts";

const scope = globalThis as typeof globalThis & { __YIFAN_BOOTED__?: boolean };
if (!scope.__YIFAN_BOOTED__) {
  scope.__YIFAN_BOOTED__ = true;
  boot();
}

function boot(): void {
  let settings = defaultSettings();
  let ready = false;
  const acceptShortcut = createShortcutGate();
  let toggleChain = Promise.resolve();
  // 必须先于 force-select 挂到 window，否则禁选开启时右键 mousedown 到不了后面的监听。
  mountPageGesture(document, {
    isEnabled: () => ready && settings.gestureEnabled,
    shouldIgnore: (event) => isYifanEvent(event) || isEditableTarget(event.target),
    onAction: (action) => {
      void runShortcutAction(action);
    },
  });
  const forceSelect = createForceSelect(document, {
    onForcedMouseDown() {
      closeSelectionFloat();
      closeSelectConfirm();
    },
    onForcedMouseUp() {
      offerSelection();
    },
  });

  initFloat({
    getSettings: () => settings,
    persistTarget: async (lang) => {
      if (!isTargetLang(lang)) return;
      settings = { ...settings, targetLang: lang };
      const current = await readSettings();
      await writeSettings({ ...current, targetLang: lang });
    },
    openSettings: () => {
      void chrome.runtime.sendMessage({ type: "open-settings" });
    },
  });
  initPage({ getSettings: () => settings });

  void readSettings()
    .then((stored) => {
      settings = stored;
    })
    .catch(() => {
      settings = defaultSettings();
    })
    .finally(() => {
      ready = true;
      forceSelect.setEnabled(settings.forceSelectEnabled);
    });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    settings = normalizeSettings(changes[STORAGE_KEY].newValue);
    ready = true;
    forceSelect.setEnabled(settings.forceSelectEnabled);
    syncToolbarPair();
  });

  chrome.runtime.onMessage.addListener((message: ToPageMessage, _sender, sendResponse) => {
    void _sender;
    void handlePageMessage(message).then(
      (result) => sendResponse(result ?? { ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  });

  document.addEventListener("keydown", (event) => {
    if (!ready || event.repeat || event.isComposing) return;
    const action = matchShortcut(event, settings.shortcuts);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (!acceptShortcut(action)) return;
    void runShortcutAction(action);
  }, true);

  document.addEventListener("mousedown", (event) => {
    if (isYifanEvent(event)) return;
    closeSelectionFloat();
    closeSelectConfirm();
  }, true);

  document.addEventListener("mouseup", (event) => {
    if (event.button !== 0 || isYifanEvent(event)) return;
    offerSelection();
  }, true);

  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      if (isConfirmOpen()) return;
      if (dismissOcrUi()) return;
      if (isSelectConfirmOpen()) {
        closeSelectConfirm();
        return;
      }
      if (isFloatOpen()) {
        closeSelectionFloat();
        return;
      }
      if (isInlinePageOpen()) {
        clearInlinePage();
      }
      return;
    }
    if (!event.shiftKey && !event.key.startsWith("Arrow")) return;
    offerSelection();
  }, true);

  document.addEventListener("scroll", () => {
    if (isFloatOpen()) repositionFloat();
    if (isSelectConfirmOpen()) repositionSelectConfirm();
  }, true);
  window.addEventListener("resize", () => {
    if (isFloatOpen()) repositionFloat();
    if (isSelectConfirmOpen()) repositionSelectConfirm();
  });

  function offerSelection(): void {
    if (!ready || isConfirmOpen() || isOcrUiActive()) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
      if (active.id === "yifan-select-confirm" || active.id === "yifan-float" || active.id === "yifan-dialog") return;
    }
    const text = cleanSelection(window.getSelection()?.toString() ?? "");
    const action = selectionOffer({
      selectionEnabled: settings.selectionEnabled,
      selectionMode: settings.selectionMode,
      text,
    });
    if (action === "none") return;
    if (action === "confirm") {
      if (isFloatOpen() && currentFloatText() === text) return;
      if (isSelectConfirmOpen() && currentSelectConfirmText() === text) return;
      closeSelectionFloat();
      openSelectConfirm(text, (confirmed) => openSelectionFloat(confirmed));
      return;
    }
    closeSelectConfirm();
    if (isFloatOpen() && currentFloatText() === text) return;
    openSelectionFloat(text);
  }

  async function handlePageMessage(message: ToPageMessage): Promise<PageControlStatus | { ok: boolean } | void> {
    if (!message || typeof message !== "object") return;
    if (message.type === "translate-selection") {
      const live = cleanSelection(window.getSelection()?.toString() ?? "");
      const text = live || cleanSelection(message.text ?? "");
      if (!text) return;
      dismissConfirm();
      closeSelectConfirm();
      openSelectionFloat(text);
      return;
    }
    if (message.type === "page-ai-status") return pageStatus();
    if (message.type === "page-ai-stop") {
      stopInlinePage();
      return pageStatus();
    }
    if (message.type === "page-ai-clear") {
      clearInlinePage();
      return pageStatus();
    }
    if (message.type === "shortcut-notice") {
      const title = message.title.trim();
      const body = message.message.trim();
      if (title && body) await showNotice(title, body);
      return;
    }
    if (message.type === "page-ai-start" && message.via === "command") {
      if (!acceptShortcut("page")) return pageStatus();
      await runShortcutAction("page");
      return pageStatus();
    }
    if (message.type === "show-page-ai" || message.type === "page-ai-start") {
      await beginPageTranslate();
      return pageStatus();
    }
    if (message.type === "start-crop-ocr" && message.via === "command") {
      if (!acceptShortcut("crop")) return;
      await runShortcutAction("crop");
      return;
    }
    if (message.type === "start-crop-ocr") {
      await beginCrop();
      return;
    }
    if (message.type === "toggle-selection") {
      if (!acceptShortcut("selection")) return;
      await runShortcutAction("selection");
      return;
    }
    if (message.type === "show-page-google") {
      closeSelectionFloat();
      closeSelectConfirm();
      const confirmed = await showConfirm("google");
      if (!confirmed) return;
      const response = (await chrome.runtime.sendMessage({ type: "google-translate" })) as
        | { ok?: boolean; message?: string }
        | undefined;
      if (response && response.ok === false) {
        await showNotice("一翻 · 整页谷歌", response.message || "没有打开翻译。没有改动页面。");
      }
    }
  }

  async function runShortcutAction(action: ShortcutAction): Promise<void> {
    if (action === "selection") {
      await toggleSelection();
      return;
    }
    if (!settings.apiKey.trim()) {
      const notice = missingKeyNotice(action);
      await showNotice(notice.title, notice.message);
      return;
    }
    if (action === "crop") {
      await beginCrop();
      return;
    }
    await beginPageTranslate();
  }

  async function toggleSelection(): Promise<void> {
    const run = toggleChain.then(async () => {
      const current = await readSettings().catch(() => settings);
      const next = !current.selectionEnabled;
      const updated = { ...current, selectionEnabled: next };
      await writeSettings(updated);
      settings = updated;
      if (!next) {
        closeSelectionFloat();
        closeSelectConfirm();
      }
      showSelectionToast(next);
    });
    toggleChain = run.then(() => undefined, () => undefined);
    await run;
  }

  async function beginPageTranslate(): Promise<void> {
    closeSelectionFloat();
    closeSelectConfirm();
    const opened = await startInlinePage();
    if (opened === "empty") {
      await showNotice("一翻 · 整页 AI", "这一页没有找到可翻译的段落。没有改动原文。");
    }
  }

  async function beginCrop(): Promise<void> {
    closeSelectionFloat();
    closeSelectConfirm();
    dismissConfirm();
    settings = await readSettings().catch(() => settings);
    if (!providerSupportsVision(settings.provider)) {
      await showNotice("一翻 · 截图识译", NO_VISION_OCR_MESSAGE);
      return;
    }
    startCrop();
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const field = target.closest("input, textarea, select, [contenteditable]");
  if (!field) return false;
  if (field instanceof HTMLInputElement) {
    if (field.disabled || field.readOnly) return false;
    return !/^(button|checkbox|radio|submit|reset|file|image|color|range)$/i.test(field.type);
  }
  if (field instanceof HTMLTextAreaElement) return !field.disabled && !field.readOnly;
  if (field instanceof HTMLSelectElement) return !field.disabled;
  const editable = field.getAttribute("contenteditable");
  return editable != null && editable.toLowerCase() !== "false";
}
