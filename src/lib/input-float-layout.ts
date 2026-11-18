/**
 * 输入浮窗只做标题栏拖动和一键放大/还原。
 * 宽高按当前可视区域减去边距，再用实测外宽（含边框）收回来。没有边角缩放。
 */

export const INPUT_FLOAT_MARGIN = 8;
export const INPUT_FLOAT_OPEN_LEFT = 24;
export const INPUT_FLOAT_OPEN_TOP = 24;
export const INPUT_FLOAT_WIDTH = 400;
export const INPUT_FLOAT_ENLARGED_WIDTH = 640;

export interface InputFloatStyleSize {
  width: number;
  maxHeight: number;
  /** 放大时撑满可用高度。默认档跟着内容，只受 maxHeight 限制。 */
  height: number | null;
}

export function inputFloatStyleSize(opts: {
  enlarged: boolean;
  viewportWidth: number;
  viewportHeight: number;
  /** 实测外宽比写入的 width 多出来的部分，例如边框画在宽度外面。 */
  extraWidth?: number;
  /** 实测外高比可用高度多出来的部分。 */
  extraHeight?: number;
}): InputFloatStyleSize {
  const extraWidth = Math.max(0, opts.extraWidth ?? 0);
  const extraHeight = Math.max(0, opts.extraHeight ?? 0);
  const availableW = Math.max(1, opts.viewportWidth - INPUT_FLOAT_MARGIN * 2);
  const availableH = Math.max(1, opts.viewportHeight - INPUT_FLOAT_MARGIN * 2);
  const preferred = opts.enlarged ? INPUT_FLOAT_ENLARGED_WIDTH : INPUT_FLOAT_WIDTH;
  const outerW = Math.min(preferred, availableW);
  const outerH = availableH;
  return {
    width: Math.max(1, outerW - extraWidth),
    maxHeight: Math.max(1, outerH - extraHeight),
    height: opts.enlarged ? Math.max(1, outerH - extraHeight) : null,
  };
}

export function clampInputFloatOrigin(opts: {
  left: number;
  top: number;
  outerWidth: number;
  outerHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): { left: number; top: number } {
  const maxLeft = opts.viewportWidth - INPUT_FLOAT_MARGIN - opts.outerWidth;
  const maxTop = opts.viewportHeight - INPUT_FLOAT_MARGIN - opts.outerHeight;
  return {
    left: clamp(opts.left, INPUT_FLOAT_MARGIN, Math.max(INPUT_FLOAT_MARGIN, maxLeft)),
    top: clamp(opts.top, INPUT_FLOAT_MARGIN, Math.max(INPUT_FLOAT_MARGIN, maxTop)),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
