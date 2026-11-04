import { attachCornerGesture, type GestureAction, type Point } from "../lib/gesture.ts";

const TRAIL_ID = "yifan-gesture-trail";

/** 右键拐角。松开时残影立刻去掉。未达阈值不拦右键菜单。 */
export function mountPageGesture(doc: Document, options: {
  isEnabled: () => boolean;
  shouldIgnore?: (event: MouseEvent) => boolean;
  onAction: (action: GestureAction) => void;
}): () => void {
  return attachCornerGesture(doc, {
    isEnabled: options.isEnabled,
    shouldIgnore: options.shouldIgnore,
    onAction: options.onAction,
    onTrail: (points) => paintGestureTrail(doc, points),
  });
}

function paintGestureTrail(doc: Document, points: readonly Point[] | null): void {
  const existing = doc.getElementById(TRAIL_ID);
  if (!points || points.length < 2) {
    existing?.remove();
    return;
  }
  const svg = existing instanceof SVGSVGElement ? existing : createTrail(doc);
  const line = svg.querySelector("polyline");
  if (!line) return;
  line.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
}

function createTrail(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", TRAIL_ID);
  svg.setAttribute("data-yifan-ignore", "");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "fixed";
  svg.style.inset = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.pointerEvents = "none";
  svg.style.zIndex = "2147483646";
  const line = doc.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "rgba(47, 111, 237, 0.9)");
  line.setAttribute("stroke-width", "3");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  svg.append(line);
  (doc.body ?? doc.documentElement).append(svg);
  return svg;
}
