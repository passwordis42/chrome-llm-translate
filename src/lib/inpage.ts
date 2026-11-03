export interface InlineAnchor {
  id: string;
  anchor: Element;
}

const SLOT_STYLE = [
  "all:initial",
  "display:block !important",
  "box-sizing:border-box",
  "position:static !important",
  "float:none !important",
  "clear:both",
  "top:auto !important",
  "right:auto !important",
  "bottom:auto !important",
  "left:auto !important",
  "z-index:auto !important",
  "width:100%",
  "max-width:100%",
  "flex:1 0 100%",
  "grid-column:1 / -1",
  "margin:8px 0 14px",
  "padding:8px 12px",
  "border-left:3px solid #2f6fed",
  "border-radius:8px",
  "background:#f4f8ff",
  "color:#1f2937",
  'font-family:"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
  "font-size:14px",
  "line-height:1.65",
  "white-space:normal",
  "pointer-events:auto",
  "user-select:text",
].join(";");

const TAG_STYLE = [
  "all:initial",
  "display:block",
  "margin:0 0 4px",
  "font-family:inherit",
  "font-size:11px",
  "font-weight:700",
  "letter-spacing:0.04em",
  "line-height:1.4",
  "color:#2f6fed",
].join(";");

const DST_STYLE = [
  "all:initial",
  "display:block",
  "margin:0",
  "font-family:inherit",
  "font-size:15px",
  "font-weight:600",
  "line-height:1.65",
  "color:#1f2937",
  "white-space:pre-wrap",
  "overflow-wrap:anywhere",
  "user-select:text",
].join(";");

/** 在原节点后面插入译文槽。不改原文、不盖住页面、不锁滚动。 */
export function insertTranslationsBelow(blocks: readonly InlineAnchor[]): HTMLElement[] {
  const slots: HTMLElement[] = [];
  const tail = new Map<Element, Element>();
  for (const block of blocks) {
    const anchor = block.anchor;
    const doc = anchor.ownerDocument;
    if (!doc?.contains(anchor)) continue;
    const slot = createInlineSlot(doc, block.id);
    const after = tail.get(anchor) ?? anchor;
    const parent = after.parentNode;
    if (!parent) continue;
    parent.insertBefore(slot, after.nextSibling);
    tail.set(anchor, slot);
    slots.push(slot);
  }
  return slots;
}

export function inlineTarget(slot: Element): HTMLElement | null {
  const node = slot.querySelector("[data-yifan-dst]");
  if (!node || node.nodeType !== 1) return null;
  return node as HTMLElement;
}

/** 只移除本扩展插入的译文槽，原页节点留在原地。 */
export function clearInsertedTranslations(root: ParentNode): number {
  const nodes = [...root.querySelectorAll("[data-yifan-inline]")];
  for (const node of nodes) node.remove();
  return nodes.length;
}

function createInlineSlot(doc: Document, id: string): HTMLElement {
  const slot = doc.createElement("div");
  slot.setAttribute("data-yifan-inline", id);
  slot.setAttribute("data-yifan-ignore", "");
  slot.setAttribute("translate", "no");
  slot.setAttribute("contenteditable", "false");
  slot.style.cssText = SLOT_STYLE;

  const tag = doc.createElement("div");
  tag.textContent = "译文";
  tag.style.cssText = TAG_STYLE;

  const dst = doc.createElement("div");
  dst.setAttribute("data-yifan-dst", id);
  dst.dataset.state = "pending";
  dst.textContent = "翻译中…";
  dst.style.cssText = DST_STYLE;

  slot.append(tag, dst);
  return slot;
}
