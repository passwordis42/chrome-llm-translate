import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INPUT_FLOAT_MARGIN,
  INPUT_FLOAT_OPEN_LEFT,
  INPUT_FLOAT_OPEN_TOP,
  clampInputFloatOrigin,
  inputFloatStyleSize,
} from "./input-float-layout.ts";

function placed(viewportWidth: number, viewportHeight: number, enlarged = false, extraWidth = 0, extraHeight = 0) {
  const size = inputFloatStyleSize({
    enlarged,
    viewportWidth,
    viewportHeight,
    extraWidth,
    extraHeight,
  });
  const outerWidth = size.width + extraWidth;
  const outerHeight = Math.min(220, size.maxHeight + extraHeight);
  const pos = clampInputFloatOrigin({
    left: INPUT_FLOAT_OPEN_LEFT,
    top: INPUT_FLOAT_OPEN_TOP,
    outerWidth,
    outerHeight,
    viewportWidth,
    viewportHeight,
  });
  return { size, outerWidth, outerHeight, pos };
}

describe("input float stays inside the visible viewport", () => {
  it("pulls a 360px window off the 24px origin so the right edge stays inside", () => {
    const box = placed(360, 780);
    assert.equal(box.pos.left, INPUT_FLOAT_MARGIN);
    assert.ok(box.pos.left + box.outerWidth <= 360 - INPUT_FLOAT_MARGIN);
    assert.ok(box.pos.top + box.outerHeight <= 780 - INPUT_FLOAT_MARGIN);
    assert.ok(box.outerWidth <= 360 - INPUT_FLOAT_MARGIN * 2);
  });

  it("fits 390px the same way and keeps the desktop origin when 400px fits", () => {
    const narrow = placed(390, 844);
    assert.equal(narrow.pos.left, INPUT_FLOAT_MARGIN);
    assert.ok(narrow.pos.left + narrow.outerWidth <= 390 - INPUT_FLOAT_MARGIN);
    const wide = placed(1280, 800);
    assert.equal(wide.size.width, 400);
    assert.equal(wide.pos.left, INPUT_FLOAT_OPEN_LEFT);
    assert.equal(wide.pos.top, INPUT_FLOAT_OPEN_TOP);
  });

  it("shrinks the assigned width when the measured border sits outside the box", () => {
    const box = placed(360, 780, false, 2, 0);
    assert.equal(box.outerWidth, 360 - INPUT_FLOAT_MARGIN * 2);
    assert.equal(box.size.width, box.outerWidth - 2);
    assert.ok(box.pos.left + box.outerWidth <= 360 - INPUT_FLOAT_MARGIN);
  });

  it("keeps enlarge, restore, and a 200% viewport inside the same margins", () => {
    const enlarged = placed(360, 780, true);
    assert.ok(enlarged.size.height != null);
    assert.ok(enlarged.size.width <= 360 - INPUT_FLOAT_MARGIN * 2);
    assert.equal(enlarged.size.height, enlarged.size.maxHeight);
    const restored = placed(360, 780, false);
    assert.equal(restored.size.height, null);
    assert.ok(restored.pos.left + restored.outerWidth <= 360 - INPUT_FLOAT_MARGIN);
    const zoomed = placed(800, 700);
    assert.equal(zoomed.size.width, 400);
    assert.ok(zoomed.pos.left + zoomed.outerWidth <= 800 - INPUT_FLOAT_MARGIN);
    const zoomedNarrow = placed(180, 400);
    assert.ok(zoomedNarrow.pos.left + zoomedNarrow.outerWidth <= 180 - INPUT_FLOAT_MARGIN);
    assert.ok(zoomedNarrow.size.maxHeight <= 400 - INPUT_FLOAT_MARGIN * 2);
  });

  it("does not let a drag leave the viewport", () => {
    const size = inputFloatStyleSize({ enlarged: false, viewportWidth: 360, viewportHeight: 780 });
    const pos = clampInputFloatOrigin({
      left: 900,
      top: 900,
      outerWidth: size.width,
      outerHeight: 280,
      viewportWidth: 360,
      viewportHeight: 780,
    });
    assert.equal(pos.left, 360 - INPUT_FLOAT_MARGIN - size.width);
    assert.equal(pos.top, 780 - INPUT_FLOAT_MARGIN - 280);
    assert.ok(pos.left >= INPUT_FLOAT_MARGIN);
    assert.ok(pos.top >= INPUT_FLOAT_MARGIN);
  });
});
