/** 开关打开时强制放开网页正文划选。默认关，不改划词确认，也不改整页原位替换。 */

export const FORCE_SELECT_STYLE_ID = "yifan-force-select";
export const FORCE_SELECT_MARK = "data-yifan-force-select";

const SELECT_PROPS = ["user-select", "-webkit-user-select", "-moz-user-select", "-ms-user-select"] as const;
type SelectProp = (typeof SELECT_PROPS)[number];

/** 站点常用这些事件取消划选或复制。监听挂在 window 捕获阶段，且内容脚本于 document_start 注册，才能先于页面脚本。 */
export const FORCE_SELECT_EVENTS = ["selectstart", "mousedown", "mouseup", "copy", "cut", "dragstart"] as const;

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "TITLE", "HEAD"]);

export interface ForceSelectHooks {
  onForcedMouseDown?: (event: Event) => void;
  onForcedMouseUp?: (event: Event) => void;
}

interface SavedProp {
  value: string;
  priority: string;
}

type SavedStyle = Record<SelectProp, SavedProp>;

/**
 * 选择器要压过 `p.review-item-post { user-select: none !important }`（0,1,1）。
 * `html body [class]` 是（0,1,2）。内联 `!important` 再压过多类名和内联禁选。
 */
export function forceSelectCss(): string {
  return [
    "html, body,",
    "html body[class], html body[id],",
    "html body [class], html body [id], html body :not([class]),",
    "html body *, html body *::before, html body *::after {",
    "  -webkit-user-select: text !important;",
    "  -moz-user-select: text !important;",
    "  -ms-user-select: text !important;",
    "  user-select: text !important;",
    "}",
  ].join("\n");
}

export function writeForceSelectInline(style: { setProperty(property: string, value: string, priority?: string): void }): void {
  for (const prop of SELECT_PROPS) style.setProperty(prop, "text", "important");
}

export function isPrimaryPointer(event: Event): boolean {
  if (!("button" in event)) return true;
  const button = (event as MouseEvent).button;
  return button === undefined || button === 0;
}

export interface ForceSelectController {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

export function createForceSelect(doc: Document, hooks: ForceSelectHooks = {}): ForceSelectController {
  let enabled = false;
  let observer: MutationObserver | null = null;
  let depth = 0;
  const saved = new WeakMap<Element, SavedStyle>();

  const onGuard = (event: Event): void => {
    if (!enabled || isExtensionUiEvent(event) || isNativeEditable(event)) return;
    if (event.type === "mousedown") hooks.onForcedMouseDown?.(event);
    if (event.type === "mouseup" && isPrimaryPointer(event)) hooks.onForcedMouseUp?.(event);
    event.stopImmediatePropagation();
  };

  const view = doc.defaultView;
  if (view) {
    for (const type of FORCE_SELECT_EVENTS) view.addEventListener(type, onGuard, true);
  }
  doc.addEventListener("DOMContentLoaded", () => {
    if (enabled) activate();
  }, { once: true });

  function setEnabled(next: boolean): void {
    if (!next) {
      if (!enabled && !doc.getElementById(FORCE_SELECT_STYLE_ID)) return;
      enabled = false;
      deactivate();
      return;
    }
    enabled = true;
    activate();
  }

  function activate(): void {
    ensureStyle();
    depth += 1;
    try {
      if (doc.documentElement) lockNode(doc.documentElement);
    } finally {
      depth -= 1;
    }
    ensureObserver();
  }

  function deactivate(): void {
    observer?.disconnect();
    observer = null;
    for (const node of doc.querySelectorAll(`[${FORCE_SELECT_MARK}]`)) restoreElement(node);
    doc.getElementById(FORCE_SELECT_STYLE_ID)?.remove();
  }

  function ensureStyle(): void {
    if (doc.getElementById(FORCE_SELECT_STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = FORCE_SELECT_STYLE_ID;
    style.setAttribute("data-yifan-ignore", "");
    style.textContent = forceSelectCss();
    (doc.head ?? doc.documentElement)?.append(style);
  }

  function ensureObserver(): void {
    if (observer || !doc.documentElement) return;
    const Ctor = doc.defaultView?.MutationObserver;
    if (typeof Ctor !== "function") return;
    observer = new Ctor((records) => {
      if (!enabled || depth > 0) return;
      depth += 1;
      try {
        for (const record of records) {
          if (record.type === "attributes") {
            if (record.target.nodeType === 1) lockElement(record.target as Element);
          } else {
            for (const node of record.addedNodes) {
              if (node.nodeType === 1) lockNode(node as Element);
            }
          }
        }
      } finally {
        depth -= 1;
      }
    });
    observer.observe(doc.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
  }

  function lockNode(root: Element): void {
    if (isLockable(root)) lockElement(root);
    if (typeof root.querySelectorAll !== "function") return;
    for (const child of root.querySelectorAll("*")) {
      if (isLockable(child)) lockElement(child);
    }
  }

  function lockElement(el: Element): void {
    if (!isLockable(el)) return;
    const style = (el as HTMLElement).style;
    if (!saved.has(el)) saved.set(el, snapshot(style));
    if (SELECT_PROPS.some((prop) => needsLock(style, prop))) writeForceSelectInline(style);
    if (!el.hasAttribute(FORCE_SELECT_MARK)) el.setAttribute(FORCE_SELECT_MARK, "");
  }

  function restoreElement(el: Element): void {
    const style = (el as HTMLElement).style;
    const previous = saved.get(el);
    if (style && typeof style.removeProperty === "function") {
      for (const prop of SELECT_PROPS) {
        style.removeProperty(prop);
        const prev = previous?.[prop];
        if (prev?.value) style.setProperty(prop, prev.value, prev.priority);
      }
    }
    saved.delete(el);
    el.removeAttribute(FORCE_SELECT_MARK);
  }

  return {
    setEnabled,
    isEnabled: () => enabled,
  };
}

function snapshot(style: CSSStyleDeclaration): SavedStyle {
  const result = {} as SavedStyle;
  for (const prop of SELECT_PROPS) {
    result[prop] = {
      value: style.getPropertyValue(prop),
      priority: readPriority(style, prop),
    };
  }
  return result;
}

function needsLock(style: CSSStyleDeclaration, prop: string): boolean {
  if (style.getPropertyValue(prop) !== "text") return true;
  if (typeof style.getPropertyPriority !== "function") return false;
  return style.getPropertyPriority(prop) !== "important";
}

function readPriority(style: CSSStyleDeclaration, prop: string): string {
  if (typeof style.getPropertyPriority !== "function") return "";
  try {
    return style.getPropertyPriority(prop) || "";
  } catch {
    return "";
  }
}

function isLockable(el: Element): boolean {
  if (el.nodeType !== 1) return false;
  const style = (el as HTMLElement).style;
  if (!style || typeof style.setProperty !== "function") return false;
  if (SKIP_TAGS.has(el.tagName)) return false;
  if (typeof el.closest === "function" && el.closest("head, [data-yifan-ignore]")) return false;
  return true;
}

function eventNodes(event: Event): EventTarget[] {
  const nodes: EventTarget[] = [];
  if (typeof event.composedPath === "function") {
    for (const node of event.composedPath()) nodes.push(node);
  }
  if (event.target) nodes.push(event.target);
  return nodes;
}

function isExtensionUiEvent(event: Event): boolean {
  for (const node of eventNodes(event)) {
    if (!node || typeof node !== "object") continue;
    const el = node as HTMLElement;
    if (typeof el.id === "string" && el.id.startsWith("yifan-")) return true;
    if (typeof el.hasAttribute === "function" && el.hasAttribute("data-yifan-ignore")) return true;
    if (typeof el.closest === "function" && el.closest("[data-yifan-ignore]")) return true;
  }
  return false;
}

function isNativeEditable(event: Event): boolean {
  for (const node of eventNodes(event)) {
    if (!node || typeof node !== "object") continue;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
  }
  return false;
}
