export interface MenuItem {
  id: string;
  title?: string;
  type?: "separator";
  contexts: Array<"page" | "selection" | "action">;
}

/** 与 UI 稿右键菜单文案一致。整页 AI 直接开始；整页谷歌仍要确认。 */
export function menuItems(): MenuItem[] {
  return [
    { id: "translate-selection", title: "翻译选中内容", contexts: ["selection"] },
    { id: "page-ai", title: "整页 AI 翻译…", contexts: ["page", "selection", "action"] },
    { id: "page-google", title: "整页谷歌翻译…", contexts: ["page", "selection", "action"] },
    { id: "sep-settings", type: "separator", contexts: ["page", "selection", "action"] },
    { id: "open-settings", title: "打开设置", contexts: ["page", "selection", "action"] },
  ];
}
