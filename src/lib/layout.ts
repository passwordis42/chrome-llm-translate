export interface Box {
  left: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

const MARGIN = 8;
const GAP = 8;

export function computeFloatPosition(opts: {
  rect: Box | null;
  card: Size;
  viewport: Size;
}): { left: number; top: number } {
  const { rect, card, viewport } = opts;
  const maxLeft = Math.max(MARGIN, viewport.width - card.width - MARGIN);
  const maxTop = Math.max(MARGIN, viewport.height - card.height - MARGIN);

  if (!rect) {
    return {
      left: clamp((viewport.width - card.width) / 2, MARGIN, maxLeft),
      top: clamp(viewport.height / 5, MARGIN, maxTop),
    };
  }

  let top = rect.bottom + GAP;
  if (top + card.height > viewport.height - MARGIN) {
    top = rect.top - card.height - GAP;
  }
  return {
    left: clamp(rect.left, MARGIN, maxLeft),
    top: clamp(top, MARGIN, maxTop),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
