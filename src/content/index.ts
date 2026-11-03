import { dismissConfirm, isConfirmOpen, showConfirm, showNotice } from "./confirm.ts";
import { isYifanEvent } from "./dom.ts";
import { closeSelectionFloat, currentFloatText, initFloat, isFloatOpen, openSelectionFloat, repositionFloat } from "./float.ts";
import { clearInlinePage, initPage, isInlinePageOpen, openInlinePage } from "./pageview.ts";
import type { ToPageMessage } from "../lib/messages.ts";
import { cleanSelection, shouldOfferSelection } from "../lib/selection.ts";
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
    });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    settings = normalizeSettings(changes[STORAGE_KEY].newValue);
    ready = true;
  });

  chrome.runtime.onMessage.addListener((message: ToPageMessage, _sender, sendResponse) => {
    void _sender;
    void handlePageMessage(message).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  });

  document.addEventListener("mousedown", (event) => {
    if (isYifanEvent(event)) return;
    closeSelectionFloat();
  }, true);

  document.addEventListener("mouseup", (event) => {
    if (event.button !== 0 || isYifanEvent(event)) return;
    offerSelection();
  }, true);

  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      if (isConfirmOpen()) return;
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
  }, true);
  window.addEventListener("resize", () => {
    if (isFloatOpen()) repositionFloat();
  });

  function offerSelection(): void {
    if (!ready || !settings.selectionEnabled) return;
    if (isConfirmOpen()) return;
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    const text = cleanSelection(window.getSelection()?.toString() ?? "");
    if (!shouldOfferSelection(true, text)) return;
    if (isFloatOpen() && currentFloatText() === text) return;
    openSelectionFloat(text);
  }

  async function handlePageMessage(message: ToPageMessage): Promise<void> {
    if (!message || typeof message !== "object") return;
    if (message.type === "translate-selection") {
      const live = cleanSelection(window.getSelection()?.toString() ?? "");
      const text = live || cleanSelection(message.text ?? "");
      if (!text) return;
      dismissConfirm();
      openSelectionFloat(text);
      return;
    }
    if (message.type === "show-page-ai") {
      closeSelectionFloat();
      const confirmed = await showConfirm("ai");
      if (!confirmed) return;
      const opened = await openInlinePage();
      if (opened === "empty") {
        await showNotice("一翻 · 整页 AI", "这一页没有找到可翻译的段落。没有改动原文。");
      }
      return;
    }
    if (message.type === "show-page-google") {
      closeSelectionFloat();
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
