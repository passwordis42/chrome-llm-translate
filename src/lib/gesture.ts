/** 右键拐角手势。只认恰好一个直角的两段折线，直线和反方向不触发。 */

export const GESTURE_THRESHOLDS = {
  /** 相邻采样点小于此距离视为抖动，不计入折线。 */
  jitterPx: 4,
  /** 每一段折线的最短弦长（CSS 像素）。短于这一段不触发，并放行右键菜单。 */
  minSegmentPx: 48,
  /** 整条轨迹相对起终点连线的偏离小于此值，视为没有拐角的直线。 */
  minCornerDeviationPx: 24,
  /** 拐角夹角与 90° 的允许偏差。超出则视为不拐或拐得不够。 */
  maxAngleErrorDeg: 28,
  /** 每一段相对自身弦的最大偏离 / 弦长。超过说明这段不直（多拐或弧线）。 */
  maxLegDeviationRatio: 0.22,
  /** 主轴分量至少是另一轴的这么多倍，斜线不算「向右 / 向下」。 */
  axisDominance: 1.7,
} as const;

export type GestureThresholds = typeof GESTURE_THRESHOLDS;

export type GestureAction = "page" | "crop" | "selection";

export interface Point {
  x: number;
  y: number;
}

type Cardinal = "right" | "left" | "down" | "up";

/**
 * ⌝ 先右再下 → 整页开始/继续。
 * ⌟ 先下再右 → 截图识译。
 * ⌞ 先下再左 → 划词开/关。
 * 方向反了、直线、夹角不够、任一段太短、多于一个拐角 → null。
 */
export function recognizeCornerGesture(
  points: readonly Point[],
  thresholds: GestureThresholds = GESTURE_THRESHOLDS,
): GestureAction | null {
  const path = decimatePoints(points, thresholds.jitterPx);
  if (path.length < 3) return null;
  const start = path[0];
  const end = path[path.length - 1];
  if (!start || !end) return null;

  let cornerIndex = -1;
  let cornerDeviation = 0;
  for (let index = 1; index < path.length - 1; index += 1) {
    const point = path[index];
    if (!point) continue;
    const deviation = distanceToLine(point, start, end);
    if (deviation > cornerDeviation) {
      cornerDeviation = deviation;
      cornerIndex = index;
    }
  }
  if (cornerIndex < 0 || cornerDeviation < thresholds.minCornerDeviationPx) return null;

  const corner = path[cornerIndex];
  if (!corner) return null;
  const firstLength = chord(start, corner);
  const secondLength = chord(corner, end);
  if (firstLength < thresholds.minSegmentPx || secondLength < thresholds.minSegmentPx) return null;

  const firstBend = maxDeviation(path, 0, cornerIndex);
  const secondBend = maxDeviation(path, cornerIndex, path.length - 1);
  if (firstBend / firstLength > thresholds.maxLegDeviationRatio) return null;
  if (secondBend / secondLength > thresholds.maxLegDeviationRatio) return null;

  const turn = angleDeg(start, corner, end);
  if (Math.abs(turn - 90) > thresholds.maxAngleErrorDeg) return null;

  const first = cardinal(start, corner, thresholds.axisDominance);
  const second = cardinal(corner, end, thresholds.axisDominance);
  if (first === "right" && second === "down") return "page";
  if (first === "down" && second === "right") return "crop";
  if (first === "down" && second === "left") return "selection";
  return null;
}

export function decimatePoints(points: readonly Point[], jitterPx: number): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const prev = kept[kept.length - 1];
    if (!prev || Math.hypot(point.x - prev.x, point.y - prev.y) >= jitterPx) kept.push({ x: point.x, y: point.y });
  }
  const last = points[points.length - 1];
  const tail = kept[kept.length - 1];
  if (last && tail && (last.x !== tail.x || last.y !== tail.y)) {
    if (Math.hypot(last.x - tail.x, last.y - tail.y) < jitterPx && kept.length > 1) {
      kept[kept.length - 1] = { x: last.x, y: last.y };
    } else {
      kept.push({ x: last.x, y: last.y });
    }
  }
  return kept;
}

export interface CornerGestureOptions {
  isEnabled: () => boolean;
  shouldIgnore?: (event: MouseEvent) => boolean;
  onAction: (action: GestureAction) => void;
  /** 进行中给出采样点；松开或取消时传 null，残影应立刻消失。 */
  onTrail?: (points: readonly Point[] | null) => void;
}

/**
 * 按住右键拖、松开识别。只在识别成功时抑制紧随其后的 contextmenu。
 * 左键、未达阈值、开关关闭：不 preventDefault，系统右键菜单照常出现。
 */
export function attachCornerGesture(doc: Document, options: CornerGestureOptions): () => void {
  const view = doc.defaultView;
  const seen = new WeakSet<Event>();
  let points: Point[] | null = null;
  let matched = false;
  let fired = false;
  let menuTimer = 0;

  const clearMenuTimer = () => {
    if (!view || menuTimer === 0) return;
    view.clearTimeout(menuTimer);
    menuTimer = 0;
  };

  const reset = () => {
    clearMenuTimer();
    points = null;
    matched = false;
    fired = false;
  };

  const finishTrail = () => {
    options.onTrail?.(null);
  };

  const fire = (action: GestureAction) => {
    if (fired) return;
    fired = true;
    matched = true;
    finishTrail();
    options.onAction(action);
  };

  const onMouseDown = (event: Event) => {
    if (seen.has(event)) return;
    seen.add(event);
    const pointer = pointerOf(event);
    if (!pointer || pointer.button !== 2) return;
    clearMenuTimer();
    points = null;
    matched = false;
    fired = false;
    if (!options.isEnabled()) return;
    if (options.shouldIgnore?.(pointer)) return;
    points = [{ x: pointer.clientX, y: pointer.clientY }];
    options.onTrail?.(points);
  };

  const onMouseMove = (event: Event) => {
    if (seen.has(event)) return;
    seen.add(event);
    const pointer = pointerOf(event);
    if (!pointer || !points || fired) return;
    if ((pointer.buttons & 2) === 0) return;
    const next = { x: pointer.clientX, y: pointer.clientY };
    const prev = points[points.length - 1];
    if (prev && Math.hypot(next.x - prev.x, next.y - prev.y) < 1) return;
    points.push(next);
    options.onTrail?.(points);
  };

  const onMouseUp = (event: Event) => {
    if (seen.has(event)) return;
    seen.add(event);
    const pointer = pointerOf(event);
    if (!pointer || pointer.button !== 2 || !points) return;
    const action = recognizeCornerGesture(points);
    if (!action) {
      finishTrail();
      reset();
      return;
    }
    matched = true;
    fire(action);
    if (!view) return;
    clearMenuTimer();
    menuTimer = view.setTimeout(() => {
      menuTimer = 0;
      if (matched) reset();
    }, 400);
  };

  const onContextMenu = (event: Event) => {
    if (seen.has(event)) return;
    seen.add(event);
    if (!points && !matched) return;
    const action = points ? recognizeCornerGesture(points) : null;
    if (!action && !matched) return;
    event.preventDefault();
    event.stopPropagation();
    if (action) fire(action);
    reset();
  };

  // window 捕获先于 document，也先于「允许划选被禁文字」对 mousedown 的拦截。
  const targets: EventTarget[] = view ? [view, doc] : [doc];
  for (const target of targets) {
    target.addEventListener("mousedown", onMouseDown, true);
    target.addEventListener("mousemove", onMouseMove, true);
    target.addEventListener("mouseup", onMouseUp, true);
    target.addEventListener("contextmenu", onContextMenu, true);
  }

  return () => {
    finishTrail();
    reset();
    for (const target of targets) {
      target.removeEventListener("mousedown", onMouseDown, true);
      target.removeEventListener("mousemove", onMouseMove, true);
      target.removeEventListener("mouseup", onMouseUp, true);
      target.removeEventListener("contextmenu", onContextMenu, true);
    }
  };
}

function pointerOf(event: Event): MouseEvent | null {
  if (!("button" in event) || !("clientX" in event) || !("clientY" in event)) return null;
  return event as MouseEvent;
}

function chord(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function distanceToLine(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  return Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / length;
}

function maxDeviation(points: readonly Point[], start: number, end: number): number {
  const a = points[start];
  const b = points[end];
  if (!a || !b) return Number.POSITIVE_INFINITY;
  let max = 0;
  for (let index = start + 1; index < end; index += 1) {
    const point = points[index];
    if (!point) continue;
    max = Math.max(max, distanceToLine(point, a, b));
  }
  return max;
}

function angleDeg(a: Point, corner: Point, b: Point): number {
  const v1x = a.x - corner.x;
  const v1y = a.y - corner.y;
  const v2x = b.x - corner.x;
  const v2y = b.y - corner.y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return 0;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function cardinal(from: Point, to: Point, dominance: number): Cardinal | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= ay * dominance && ax > 0) return dx > 0 ? "right" : "left";
  if (ay >= ax * dominance && ay > 0) return dy > 0 ? "down" : "up";
  return null;
}
