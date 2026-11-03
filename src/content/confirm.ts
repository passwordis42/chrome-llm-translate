import { CONFIRM_DETAIL, CONFIRM_EMPHASIS, CONFIRM_LEAD } from "../lib/inpage.ts";
import { el, lockPageScroll, markImg, mount, unlockPageScroll } from "./dom.ts";

let closeCurrent: ((value: boolean) => void) | null = null;

export function isConfirmOpen(): boolean {
  return closeCurrent != null;
}

export function dismissConfirm(): void {
  closeCurrent?.(false);
}

export function showConfirm(mode: "ai" | "google"): Promise<boolean> {
  dismissConfirm();
  return new Promise((resolve) => {
    const { host, root } = mount("yifan-dialog");
    lockPageScroll();
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (closeCurrent === finish) closeCurrent = null;
      host.remove();
      unlockPageScroll();
      resolve(value);
    };
    closeCurrent = finish;

    const backdrop = el("div", "backdrop");
    const dialog = el("div", "dialog");
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "yifan-confirm-title");

    const head = el("div", "hd");
    const titles = el("div");
    const title = el("h1", undefined, mode === "ai" ? "一翻 · 整页 AI" : "一翻 · 整页谷歌");
    title.id = "yifan-confirm-title";
    const sub = el(
      "div",
      "sub",
      mode === "ai" ? "需确认后才会开始翻译" : "用于不重要的整页 · 须确认",
    );
    titles.append(title, sub);
    head.append(markImg(32), titles);

    const body = el("div", "body");
    const message = el("p", "msg");
    if (mode === "ai") {
      message.append(CONFIRM_LEAD, el("strong", undefined, CONFIRM_EMPHASIS), "？");
    } else {
      message.append("用浏览器自带", el("strong", undefined, "谷歌翻译"), "整页？");
    }
    const detail = el("div", "detail");
    if (mode === "ai") {
      detail.textContent = CONFIRM_DETAIL;
    } else {
      detail.append(
        "只尝试唤起浏览器自带的原页翻译，留在当前页。",
        el("em", undefined, "不跳转"),
        "到 translate.google.com，也不做 LLM 双语。取消则无副作用。",
      );
    }

    const actionRow = el("div", "actions");
    const cancel = el("button", "btn", "取消");
    cancel.type = "button";
    const ok = el("button", mode === "google" ? "btn primary google" : "btn primary", mode === "ai" ? "确认翻译" : "唤起页面翻译");
    ok.type = "button";
    cancel.addEventListener("click", () => finish(false));
    ok.addEventListener("click", () => finish(true));
    actionRow.append(cancel, ok);
    body.append(message, detail, actionRow);
    dialog.append(head, body);
    backdrop.append(dialog);
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) finish(false);
    });
    root.append(backdrop);
    root.addEventListener("keydown", (event: Event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    });
    cancel.focus();
  });
}

export function showNotice(title: string, message: string): Promise<void> {
  dismissConfirm();
  return new Promise((resolve) => {
    const { host, root } = mount("yifan-dialog");
    lockPageScroll();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      closeCurrent = null;
      host.remove();
      unlockPageScroll();
      resolve();
    };
    closeCurrent = () => finish();
    const backdrop = el("div", "backdrop");
    const dialog = el("div", "dialog");
    dialog.setAttribute("role", "alertdialog");
    const head = el("div", "hd");
    const titleWrap = el("div");
    titleWrap.append(el("h1", undefined, title), el("div", "sub", "没有改动页面"));
    head.append(markImg(32), titleWrap);
    const body = el("div", "body");
    const detail = el("div", "detail", message);
    const actionRow = el("div", "actions");
    const close = el("button", "btn primary", "关闭");
    close.type = "button";
    close.addEventListener("click", finish);
    actionRow.append(close);
    body.append(detail, actionRow);
    dialog.append(head, body);
    backdrop.append(dialog);
    root.append(backdrop);
    close.focus();
  });
}
