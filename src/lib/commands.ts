import type { ToPageMessage } from "./messages.ts";
import type { GestureAction } from "./gesture.ts";

export const PAGE_TRANSLATE_COMMAND = "start-page-translate";
export const CROP_OCR_COMMAND = "start-crop-ocr";
export const TOGGLE_SELECTION_COMMAND = "toggle-selection";

export const SUGGESTED_PAGE_SHORTCUT = "Alt+T";
export const SUGGESTED_CROP_SHORTCUT = "Alt+S";
export const SUGGESTED_SELECTION_SHORTCUT = "Alt+E";

export type ShortcutAction = GestureAction;

export function shortcutAction(command: string): ShortcutAction | null {
  if (command === PAGE_TRANSLATE_COMMAND) return "page";
  if (command === CROP_OCR_COMMAND) return "crop";
  if (command === TOGGLE_SELECTION_COMMAND) return "selection";
  return null;
}

export function commandToPageMessage(action: ShortcutAction): ToPageMessage {
  if (action === "page") return { type: "page-ai-start", via: "command" };
  if (action === "crop") return { type: "start-crop-ocr", via: "command" };
  return { type: "toggle-selection", via: "command" };
}

/** 内容脚本只注入 http/https。chrome://、edge://、商店、PDF 查看器都不算可操作页。 */
export function isHttpPageUrl(url: string | undefined): boolean {
  return !!url && (url.startsWith("http://") || url.startsWith("https://"));
}

export interface ShortcutNotice {
  title: string;
  message: string;
}

export interface ShortcutDecision {
  action: ShortcutAction;
  /** 为 true 时向页面发送与主弹窗相同的开始 / 截图消息。 */
  deliver: boolean;
  notice: ShortcutNotice | null;
}

export function decideShortcut(input: {
  command: string;
  url?: string;
  hasApiKey: boolean;
}): ShortcutDecision | null {
  const action = shortcutAction(input.command);
  if (!action) return null;
  if (!isHttpPageUrl(input.url)) {
    return { action, deliver: false, notice: unavailablePageNotice(action, input.url) };
  }
  if (action !== "selection" && !input.hasApiKey) {
    return { action, deliver: false, notice: missingKeyNotice(action) };
  }
  return { action, deliver: true, notice: null };
}

export function missingKeyNotice(action: ShortcutAction): ShortcutNotice {
  if (action === "crop") {
    return {
      title: "一翻 · 截图识译",
      message: "请先在设置中填写 API Key。不会假翻。没有改动正文。",
    };
  }
  if (action === "selection") {
    return {
      title: "一翻 · 划词",
      message: "请先在设置中填写 API Key。不会假翻。",
    };
  }
  return {
    title: "一翻 · 整页",
    message: "请先在设置中填写 API Key。不会假翻。",
  };
}

export function unavailablePageNotice(action: ShortcutAction, url?: string): ShortcutNotice {
  const where = blockedPageLabel(url);
  if (action === "crop") {
    return {
      title: "一翻 · 截图识译",
      message: `${where}，不能截图识译。请打开普通网页后再试。没有改动正文。`,
    };
  }
  if (action === "selection") {
    return {
      title: "一翻 · 划词",
      message: `${where}，不能切换划词。请打开普通网页后再试。`,
    };
  }
  return {
    title: "一翻 · 整页",
    message: `${where}，不能整页翻译。请打开普通网页后再试。`,
  };
}

export function injectionFailedNotice(action: ShortcutAction): ShortcutNotice {
  if (action === "crop") {
    return {
      title: "一翻 · 截图识译",
      message: "这个页面不能截图识译。请打开普通网页后再试。没有改动正文。",
    };
  }
  if (action === "selection") {
    return {
      title: "一翻 · 划词",
      message: "这个页面不能切换划词。请打开普通网页后再试。",
    };
  }
  return {
    title: "一翻 · 整页",
    message: "这个页面不能整页翻译。请打开普通网页后再试。",
  };
}

export function blockedPageLabel(url: string | undefined): string {
  if (!url) return "当前没有可操作的网页";
  let protocol = "";
  try {
    protocol = new URL(url).protocol;
  } catch {
    protocol = "";
  }
  if (
    protocol === "chrome:"
    || protocol === "edge:"
    || protocol === "about:"
    || protocol === "devtools:"
    || protocol === "chrome-extension:"
    || protocol === "edge-extension:"
  ) {
    return `当前页是浏览器内部页（${protocol}//）`;
  }
  if (
    url.startsWith("https://chrome.google.com/webstore")
    || url.startsWith("https://chromewebstore.google.com")
    || url.includes("microsoftedge.microsoft.com/addons")
  ) {
    return "当前页是扩展商店";
  }
  if (protocol === "file:") return "本地文件页";
  if (protocol === "view-source:") return "当前页是源代码视图";
  return "当前页";
}
