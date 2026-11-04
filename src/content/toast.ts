import { el, mount } from "./dom.ts";

const TOAST_MS = 1600;

/** 页内轻提示。不锁滚动，也不关掉整页翻译工具条。 */
export function showSelectionToast(enabled: boolean): void {
  const { host, root } = mount("yifan-toast");
  if (document.getElementById("yifan-inline-bar")) host.classList.add("above-bar");
  const toast = el("div", enabled ? "toast on" : "toast");
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  const dot = el("span", "dot");
  dot.setAttribute("aria-hidden", "true");
  toast.append(dot, document.createTextNode(enabled ? "划词已开" : "划词已关"));
  root.append(toast);
  const view = host.ownerDocument.defaultView;
  view?.setTimeout(() => {
    if (host.isConnected) host.remove();
  }, TOAST_MS);
}
