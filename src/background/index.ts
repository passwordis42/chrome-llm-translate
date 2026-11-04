import {
  commandToPageMessage,
  decideShortcut,
  injectionFailedNotice,
  isHttpPageUrl,
  type ShortcutNotice,
} from "../lib/commands.ts";
import { decideGooglePage, GOOGLE_IN_PAGE_FAILED } from "../lib/google.ts";
import { TranslateError, missingKeyError } from "../lib/errors.ts";
import { menuItems } from "../lib/menu.ts";
import { PORT_NAME, type PortOutbound, type StartMessage, type ToPageMessage, type ToWorkerMessage } from "../lib/messages.ts";
import { OcrTranslateError, recognizeAndTranslate } from "../lib/ocr.ts";
import { isProviderId } from "../lib/providers.ts";
import { loadQuotaView, readLedger } from "../lib/quota.ts";
import { testConnection } from "../lib/qwen.ts";
import { INVALID_MODEL_MESSAGE, isModelId, readSettings } from "../lib/settings.ts";
import { runTranslationJob } from "../lib/translate-job.ts";

function setupMenus(): void {
  chrome.contextMenus.removeAll(() => {
    for (const item of menuItems()) {
      chrome.contextMenus.create({
        id: item.id,
        ...(item.type === "separator" ? { type: "separator" as const } : { title: item.title }),
        contexts: item.contexts,
      } as chrome.contextMenus.CreateProperties);
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupMenus();
  void injectOpenTabs();
});

chrome.runtime.onStartup.addListener(() => {
  setupMenus();
});

chrome.commands.onCommand.addListener((command) => {
  void runShortcut(command);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (id === "open-settings") {
    void chrome.runtime.openOptionsPage();
    return;
  }
  void dispatchMenu(id, tab, info.selectionText);
});

chrome.runtime.onMessage.addListener((message: ToWorkerMessage, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then((result) => sendResponse(result))
    .catch(() => sendResponse({ ok: false, message: "操作失败。没有假翻。" }));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  const abort = new AbortController();
  port.onDisconnect.addListener(() => abort.abort());
  port.onMessage.addListener((message: StartMessage) => {
    if (!message || message.type !== "start" || typeof message.text !== "string") return;
    void runPort(port, message, abort.signal);
  });
});

async function dispatchMenu(id: string, tab: chrome.tabs.Tab | undefined, selectionText?: string): Promise<void> {
  const target = tab?.id != null ? tab : await activeTab();
  if (target?.id == null) return;
  if (id === "translate-selection") {
    await deliver(target.id, { type: "translate-selection", text: selectionText ?? "" });
    return;
  }
  if (id === "page-ai") {
    await deliver(target.id, { type: "show-page-ai" });
    return;
  }
  if (id === "page-google") {
    await deliver(target.id, { type: "show-page-google" });
    return;
  }
  if (id === "crop-ocr") {
    await deliver(target.id, { type: "start-crop-ocr" });
  }
}

async function runShortcut(command: string): Promise<void> {
  const tab = await activeTab();
  const settings = await readSettings();
  const decision = decideShortcut({
    command,
    url: tab?.url,
    hasApiKey: settings.apiKey.trim().length > 0,
  });
  if (!decision) return;
  if (decision.deliver && tab?.id != null) {
    const delivered = await deliver(tab.id, commandToPageMessage(decision.action));
    if (delivered) return;
    await notify(injectionFailedNotice(decision.action));
    return;
  }
  const notice = decision.notice ?? injectionFailedNotice(decision.action);
  if (tab?.id != null && decision.notice && isHttpPageUrl(tab.url)) {
    const shown = await deliver(tab.id, {
      type: "shortcut-notice",
      title: notice.title,
      message: notice.message,
    });
    if (shown) return;
  }
  await notify(notice);
}

async function notify(notice: ShortcutNotice): Promise<void> {
  try {
    await chrome.notifications.create("yifan-shortcut", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: notice.title,
      message: notice.message,
    });
  } catch {
    try {
      await chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
      await chrome.action.setBadgeText({ text: "!" });
      await chrome.action.setTitle({ title: `${notice.title}：${notice.message}` });
    } catch {
      // 命令回调里不再抛，避免看起来像静默失败后又爆错。
    }
  }
}

async function deliver(tabId: number, message: ToPageMessage): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch {
      return false;
    }
  }
}

async function injectOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null) return;
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      } catch {
        // 已丢弃或受保护的标签页。
      }
    }),
  );
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function handleMessage(message: ToWorkerMessage, sender: chrome.runtime.MessageSender) {
  if (!message || typeof message !== "object") return { ok: false, message: "无法识别的请求。" };
  if (message.type === "open-settings") {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }
  if (message.type === "test-connection") {
    const apiKey = typeof message.apiKey === "string" ? message.apiKey.trim() : "";
    const model = typeof message.model === "string" ? message.model.trim() : "";
    if (!isModelId(model)) {
      return { ok: false, title: "连接失败", message: INVALID_MODEL_MESSAGE };
    }
    if (!apiKey) {
      const error = missingKeyError("settings");
      return { ok: false, title: error.title, message: error.message };
    }
    const provider = isProviderId(message.provider) ? message.provider : "qwen";
    try {
      await testConnection({ apiKey, model, provider });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        title: error instanceof TranslateError ? error.title : "连接失败",
        message:
          error instanceof TranslateError
            ? error.message
            : "API Key 无效或网络不可达。请检查后重试——不会假翻。",
      };
    }
  }
  if (message.type === "quota-status") {
    const provider = isProviderId(message.provider) ? message.provider : "qwen";
    const apiKey = typeof message.apiKey === "string" ? message.apiKey.trim() : "";
    const ledger = await readLedger();
    const view = await loadQuotaView({ provider, apiKey, usage: ledger.byProvider[provider] });
    return { ok: true, view };
  }
  if (message.type === "google-translate") return openGoogleTranslate(sender);
  if (message.type === "capture-visible") return captureVisible(sender);
  if (message.type === "ocr-translate") return translateCrop(message.imageDataUrl);
  return { ok: false, message: "无法识别的请求。" };
}

async function captureVisible(sender: chrome.runtime.MessageSender) {
  const windowId = sender.tab?.windowId;
  if (windowId == null) return { ok: false, message: "找不到当前标签页。没有改动页面。不会假翻。" };
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    if (!dataUrl) return { ok: false, message: "截不到当前页面。没有改动正文。不会假翻。" };
    return { ok: true, dataUrl };
  } catch {
    return { ok: false, message: "截不到当前页面。没有改动正文。不会假翻。" };
  }
}

async function translateCrop(imageDataUrl: unknown) {
  const image = typeof imageDataUrl === "string" ? imageDataUrl : "";
  try {
    const settings = await readSettings();
    const result = await recognizeAndTranslate({
      imageDataUrl: image,
      settings,
      signal: new AbortController().signal,
    });
    return { ok: true, source: result.source, translation: result.translation };
  } catch (error) {
    return {
      ok: false,
      title: error instanceof TranslateError ? error.title : "识译失败",
      message: error instanceof TranslateError ? error.message : "识译失败。不会假翻。页面正文没有改动。",
      source: error instanceof OcrTranslateError ? error.source : "",
    };
  }
}

async function openGoogleTranslate(sender: chrome.runtime.MessageSender) {
  const tab = sender.tab?.id != null ? sender.tab : await activeTab();
  const tabsApi = chrome.tabs as typeof chrome.tabs & {
    translate?: (tabId: number, options: { targetLanguage: string }) => Promise<void>;
  };
  const translate = tabsApi.translate;
  const settings = await readSettings();
  const decision = decideGooglePage({
    pageUrl: tab?.url,
    targetLang: settings.targetLang,
    inPageApi: typeof translate === "function",
  });
  if (!decision.ok) return { ok: false, message: decision.message };
  if (tab?.id == null || typeof translate !== "function") {
    return { ok: false, message: "找不到当前标签页。没有跳转，也没有改动页面。" };
  }
  try {
    await translate(tab.id, { targetLanguage: decision.targetLanguage });
    return { ok: true, via: "chrome.tabs.translate" };
  } catch {
    return { ok: false, message: GOOGLE_IN_PAGE_FAILED };
  }
}

async function runPort(port: chrome.runtime.Port, message: StartMessage, signal: AbortSignal): Promise<void> {
  const post = (payload: PortOutbound) => {
    try {
      port.postMessage(payload);
    } catch {
      // 浮层已关。
    }
  };
  try {
    const settings = await readSettings();
    await runTranslationJob({
      text: message.text,
      settings,
      sourceLang: message.sourceLang,
      targetLang: message.targetLang,
      signal,
      onText: (text) => post({ type: "text", text }),
    });
    if (!signal.aborted) post({ type: "done" });
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
    post({
      type: "error",
      title: error instanceof TranslateError ? error.title : "翻译失败",
      message: error instanceof Error ? error.message : "翻译失败。不会假翻。",
      fatal: error instanceof TranslateError ? error.fatal : true,
    });
  }
}
