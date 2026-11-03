import { googleCode } from "./languages.ts";

/**
 * Chrome 扩展没有公开 API 可以唤起地址栏里的「翻译此页」。
 * 确认之后的退路：把当前 http(s) 页导航到谷歌翻译的网页翻译地址。
 * 这用的是浏览器翻译同一套谷歌引擎，不做 LLM 双语卡；浏览器后退可以回来。
 */
export function googleTranslateUrl(pageUrl: string, sourceLang: string, targetLang: string): string {
  const url = new URL("https://translate.google.com/translate");
  url.searchParams.set("sl", googleCode(sourceLang));
  url.searchParams.set("tl", googleCode(targetLang));
  url.searchParams.set("u", pageUrl);
  return url.toString();
}

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
