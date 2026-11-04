export interface PageBlock {
  id: string;
  text: string;
  /** 整页 AI 在这个节点里原位替换原文。替换前会另存 innerHTML。 */
  anchor: Element;
}

export interface ExtractResult {
  title: string;
  blocks: PageBlock[];
  truncated: boolean;
}

const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dd";
/** 卡片标题经常只是 a/div/span，不在上面的结构标签里。 */
const LOOSE_SELECTOR = "a,span,div,button,label,time,cite,strong,em,b,i,small,mark,abbr,u,s,q,dt,td,th,summary";
const MEDIA_SELECTOR = "img,svg,video,picture,canvas,iframe,object";
const SKIP_CLOSEST = "nav,footer,aside,[role='navigation'],[role='contentinfo'],pre,code,kbd,samp,script,style,textarea,noscript,svg,#yifan-float,#yifan-dialog,#yifan-inline-bar,[data-yifan-ignore],[data-yifan-replaced]";
const INLINE_TAGS = new Set([
  "A", "SPAN", "STRONG", "EM", "B", "I", "CITE", "TIME", "LABEL", "SMALL", "MARK", "ABBR",
  "SUB", "SUP", "U", "S", "FONT", "BR", "WBR", "Q", "CODE", "KBD", "SAMP", "VAR", "BDI", "BDO",
]);
export const PAGE_BLOCK_LIMIT = 60;
const MAX_BLOCK_CHARS = 1800;

export function extractBlocks(doc: Document, limit = PAGE_BLOCK_LIMIT): ExtractResult {
  const root = pickRoot(doc);
  const nodes = collectNodes(root);
  const blocks: PageBlock[] = [];
  let title = "";
  let truncated = false;

  for (const node of nodes) {
    if (isHiddenDeep(node)) continue;
    const parts = splitLong(elementText(node), MAX_BLOCK_CHARS);
    for (const part of parts) {
      if (!part || !/\p{L}/u.test(part)) continue;
      const tag = node.tagName.toLowerCase();
      if (!title && tag === "h1") title = part.slice(0, 180);
      if (blocks.length >= limit) {
        truncated = true;
        break;
      }
      blocks.push({ id: `b${blocks.length}`, text: part, anchor: node });
    }
    if (truncated) break;
  }

  if (!title) title = fallbackTitle(doc);
  return { title, blocks, truncated };
}

function collectNodes(root: Element): Element[] {
  const wanted = new Set<Element>();
  for (const node of root.querySelectorAll(BLOCK_SELECTOR)) {
    if (node.closest(SKIP_CLOSEST)) continue;
    if (node.querySelector(BLOCK_SELECTOR)) continue;
    wanted.add(node);
  }
  for (const node of looseHosts(root)) wanted.add(node);
  const ordered: Element[] = [];
  const walk = (node: Element): void => {
    if (wanted.has(node)) ordered.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return ordered;
}

/**
 * 不在 p/h/li 里的一整句：首页卡片标题多半是 a，偶尔是只含文本的 div。
 * 只取这一句本身，不把外层卡片（里面还有导语、图片）整段换掉。
 * 段内的行内链接仍跟着所在的 p/li，不单独拆出来。
 */
function looseHosts(root: Element): Element[] {
  const hosts = [...root.querySelectorAll(LOOSE_SELECTOR)].filter(isLooseHost);
  const hostSet = new Set(hosts);
  return hosts.filter((node) => {
    let parent = node.parentElement;
    while (parent) {
      if (hostSet.has(parent)) return false;
      parent = parent.parentElement;
    }
    return true;
  });
}

function isLooseHost(node: Element): boolean {
  if (!isPhraseContainer(node)) return false;
  if (isInline(node)) {
    const parent = node.parentElement;
    if (parent && isInline(parent) && isPhraseContainer(parent)) return false;
    return true;
  }
  return hasDirectLetterText(node);
}

function isPhraseContainer(node: Element): boolean {
  if (node.closest(SKIP_CLOSEST)) return false;
  if (node.closest(BLOCK_SELECTOR)) return false;
  if (node.querySelector(BLOCK_SELECTOR)) return false;
  if (node.querySelector(MEDIA_SELECTOR)) return false;
  if (!/\p{L}/u.test(node.textContent ?? "")) return false;
  return !hasNonInlineDescendant(node);
}

function hasNonInlineDescendant(node: Element): boolean {
  const stack = [...node.children];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (!isInline(current)) return true;
    for (const child of current.children) stack.push(child);
  }
  return false;
}

function hasDirectLetterText(node: Element): boolean {
  for (const child of node.childNodes) {
    if (child.nodeType === 3 && /\p{L}/u.test(child.textContent ?? "")) return true;
  }
  return false;
}

function isInline(node: Element): boolean {
  return INLINE_TAGS.has(node.tagName);
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
