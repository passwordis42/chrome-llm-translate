import { dismissConfirm, isConfirmOpen, showConfirm, showNotice } from "./confirm.ts";
import { dismissOcrUi, isOcrUiActive, startCrop } from "./crop.ts";
import { isYifanEvent } from "./dom.ts";
import { closeSelectionFloat, currentFloatText, initFloat, isFloatOpen, openSelectionFloat, repositionFloat } from "./float.ts";
import { clearInlinePage, initPage, isInlinePageOpen, pageStatus, startInlinePage, stopInlinePage, syncToolbarPair } from "./pageview.ts";
import { closeSelectConfirm, currentSelectConfirmText, isSelectConfirmOpen, openSelectConfirm, repositionSelectConfirm } from "./select-confirm.ts";
import type { PageControlStatus } from "../lib/inpage.ts";
import type { ToPageMessage } from "../lib/messages.ts";
import { cleanSelection, selectionOffer } from "../lib/selection.ts";
import { createForceSelect } from "../lib/force-select.ts";
import { STORAGE_KEY, defaultSettings, normalizeSettings, readSettings, writeSettings } from "../lib/settings.ts";
import { isTargetLang } from "../lib/languages.ts";

const scope = globalThis as typeof globalThis & { __YIFAN_BOOTED__?: boolean };
if (!scope.__YIFAN_BOOTED__) {
  scope.__YIFAN_BOOTED__ = true;
  boot();
}

function boot(): void {
  let settings = defaultSettings();
  let ready = false;
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
    if (message.type === "show-page-ai" || message.type === "page-ai-start") {
      closeSelectionFloat();
      closeSelectConfirm();
      const opened = await startInlinePage();
      if (opened === "empty") {
        await showNotice("一翻 · 整页 AI", "这一页没有找到可翻译的段落。没有改动原文。");
      }
      return pageStatus();
    }
    if (message.type === "start-crop-ocr") {
      closeSelectionFloat();
      closeSelectConfirm();
      dismissConfirm();
      startCrop();
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
}
