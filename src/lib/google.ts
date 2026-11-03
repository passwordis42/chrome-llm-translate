import { googleCode } from "./languages.ts";

/**
 * 整页谷歌只留在原页，尝试浏览器自带翻译。
 * 没有公开接口或调用失败时明确失败，不导航到 translate.google.com。
 */
export function canBrowserTranslate(pageUrl: string | undefined): boolean {
  if (!pageUrl) return false;
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.hostname === "translate.google.com") return false;
    return true;
  } catch {
    return false;
  }
}

export const GOOGLE_IN_PAGE_FAILED =
  "浏览器原页翻译没有调起来。没有跳转到 translate.google.com，页面保持原样。没有做 LLM 翻译。";

export type GooglePageDecision =
  | { ok: true; targetLanguage: string }
  | { ok: false; message: string };

export function decideGooglePage(input: {
  pageUrl: string | undefined;
  targetLang: string;
  /** 当前浏览器是否提供 chrome.tabs.translate。 */
  inPageApi: boolean;
}): GooglePageDecision {
  if (!canBrowserTranslate(input.pageUrl)) {
    return {
      ok: false,
      message: "当前页面不能唤起浏览器翻译，只支持普通 http(s) 网页。没有改动页面，也没有跳转。",
    };
  }
  if (!input.inPageApi) {
    return {
      ok: false,
      message:
        "当前 Chrome 没有公开的原页翻译接口，没法在本页唤起谷歌翻译。没有跳转到 translate.google.com，也没有做 LLM 翻译。",
    };
  }
  return { ok: true, targetLanguage: googleCode(input.targetLang) };
}
