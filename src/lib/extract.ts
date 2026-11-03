export interface PageBlock {
  id: string;
  text: string;
}

export interface ExtractResult {
  title: string;
  blocks: PageBlock[];
  truncated: boolean;
}

const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dd";
const SKIP_CLOSEST = "nav,footer,aside,[role='navigation'],[role='contentinfo'],#yifan-float,#yifan-dialog,#yifan-page,[data-yifan-ignore]";
const DEFAULT_LIMIT = 60;
const MAX_BLOCK_CHARS = 1800;

export function extractBlocks(doc: Document, limit = DEFAULT_LIMIT): ExtractResult {
  const root = pickRoot(doc);
  const nodes = [...root.querySelectorAll(BLOCK_SELECTOR)];
  const blocks: PageBlock[] = [];
  let title = "";
  let truncated = false;

  for (const node of nodes) {
    if (node.closest(SKIP_CLOSEST)) continue;
    if (node.querySelector(BLOCK_SELECTOR)) continue;
    if (isHiddenDeep(node)) continue;
    const parts = splitLong(elementText(node), MAX_BLOCK_CHARS);
    for (const part of parts) {
      if (!part || !/\p{L}/u.test(part)) continue;
      const tag = node.tagName.toLowerCase();
      if (!title && tag === "h1") {
        title = part.slice(0, 180);
        continue;
      }
      if (blocks.length >= limit) {
        truncated = true;
        break;
      }
      blocks.push({ id: `b${blocks.length}`, text: part });
    }
    if (truncated) break;
  }

  if (!title) title = fallbackTitle(doc);
  return { title, blocks, truncated };
}

function pickRoot(doc: Document): Element {
  for (const selector of ["article", "main"]) {
    const element = doc.querySelector(selector);
    if (element && (element.textContent ?? "").trim().length >= 80) return element;
  }
  return doc.body ?? doc.documentElement;
}

function elementText(element: Element): string {
  const withInner = element as HTMLElement;
  const raw =
    typeof withInner.innerText === "string" && withInner.innerText.trim()
      ? withInner.innerText
      : (element.textContent ?? "");
  return raw.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return text ? [text] : [];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    const piece = rest.slice(0, cut).trim();
    if (piece) parts.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function isHiddenDeep(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute("hidden")) return true;
    if (current.getAttribute("aria-hidden") === "true") return true;
    try {
      const view = current.ownerDocument?.defaultView;
      if (view?.getComputedStyle) {
        const style = view.getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden") return true;
      }
    } catch {
      return false;
    }
    current = current.parentElement;
  }
  return false;
}

function fallbackTitle(doc: Document): string {
  const title = (doc.title || "").replace(/\s+/g, " ").trim();
  return title.slice(0, 180) || "整页对照";
}
