import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import {
  CROP_OCR_COMMAND,
  PAGE_TRANSLATE_COMMAND,
  SUGGESTED_CROP_SHORTCUT,
  SUGGESTED_PAGE_SHORTCUT,
  decideShortcut,
  missingKeyNotice,
  shortcutAction,
  unavailablePageNotice,
} from "./commands.ts";
import {
  GESTURE_THRESHOLDS,
  attachCornerGesture,
  recognizeCornerGesture,
  type GestureAction,
  type Point,
} from "./gesture.ts";
import { defaultSettings, normalizeSettings } from "./settings.ts";

const T = GESTURE_THRESHOLDS;

function line(from: Point, to: Point, steps = 8): Point[] {
  const points: Point[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    points.push({
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio,
    });
  }
  return points;
}

function elbow(a: Point, b: Point, c: Point): Point[] {
  const first = line(a, b);
  const second = line(b, c).slice(1);
  return [...first, ...second];
}

function pointerEvent(
  doc: Document,
  type: string,
  init: { button: number; buttons: number; clientX: number; clientY: number },
): Event {
  const view = doc.defaultView;
  if (!view) throw new Error("document has no window");
  const event = new view.Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { value });
  }
  return event;
}

function drag(doc: Document, button: number, points: readonly Point[], buttons = button): void {
  const target = doc.body ?? doc.documentElement;
  const first = points[0] ?? { x: 0, y: 0 };
  target.dispatchEvent(pointerEvent(doc, "mousedown", { button, buttons, clientX: first.x, clientY: first.y }));
  for (const point of points.slice(1)) {
    target.dispatchEvent(pointerEvent(doc, "mousemove", { button, buttons, clientX: point.x, clientY: point.y }));
  }
  const last = points[points.length - 1] ?? first;
  target.dispatchEvent(pointerEvent(doc, "mouseup", { button, buttons: 0, clientX: last.x, clientY: last.y }));
}

function contextMenu(doc: Document): boolean {
  return (doc.body ?? doc.documentElement).dispatchEvent(pointerEvent(doc, "contextmenu", {
    button: 2,
    buttons: 0,
    clientX: 0,
    clientY: 0,
  }));
}

describe("corner gesture thresholds", () => {
  it("publishes the self-test thresholds", () => {
    assert.deepEqual(GESTURE_THRESHOLDS, {
      jitterPx: 4,
      minSegmentPx: 48,
      minCornerDeviationPx: 24,
      maxAngleErrorDeg: 28,
      maxLegDeviationRatio: 0.22,
      axisDominance: 1.7,
    });
  });

  it("maps ⌝ right-then-down to page and ⌟ down-then-right to crop", () => {
    const span = T.minSegmentPx + 36;
    assert.equal(
      recognizeCornerGesture(elbow({ x: 0, y: 0 }, { x: span, y: 0 }, { x: span, y: span })),
      "page",
    );
    assert.equal(
      recognizeCornerGesture(elbow({ x: 0, y: 0 }, { x: 0, y: span }, { x: span, y: span })),
      "crop",
    );
  });

  it("rejects a leg shorter than minSegmentPx", () => {
    const span = T.minSegmentPx - 8;
    assert.ok(span > 0);
    assert.equal(
      recognizeCornerGesture(elbow({ x: 0, y: 0 }, { x: span, y: 0 }, { x: span, y: span })),
      null,
    );
    assert.equal(
      recognizeCornerGesture(elbow({ x: 10, y: 10 }, { x: 10, y: 10 + span }, { x: 10 + span, y: 10 + span })),
      null,
    );
  });

  it("rejects a straight stroke, a reversed corner, and a turn that is not near 90 degrees", () => {
    assert.equal(recognizeCornerGesture(line({ x: 0, y: 0 }, { x: 220, y: 6 })), null);
    assert.equal(
      recognizeCornerGesture(elbow({ x: 0, y: 80 }, { x: 140, y: 80 }, { x: 140, y: 0 })),
      null,
    );
    assert.equal(
      recognizeCornerGesture(elbow({ x: 80, y: 0 }, { x: 80, y: 140 }, { x: 0, y: 140 })),
      null,
    );
    assert.equal(
      recognizeCornerGesture(elbow({ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 200, y: 90 })),
      null,
    );
  });

  it("rejects a second corner and a diagonal that is not axis-aligned", () => {
    const zigzag = [
      ...line({ x: 0, y: 0 }, { x: 90, y: 0 }),
      ...line({ x: 90, y: 0 }, { x: 90, y: 90 }).slice(1),
      ...line({ x: 90, y: 90 }, { x: 180, y: 90 }).slice(1),
    ];
    assert.equal(recognizeCornerGesture(zigzag), null);
    const rotated = elbow({ x: 0, y: 0 }, { x: 76, y: 64 }, { x: 140, y: 128 });
    assert.equal(recognizeCornerGesture(rotated), null);
  });

  it("still recognizes a noisy right angle inside the jitter budget", () => {
    const clean = elbow({ x: 4, y: 4 }, { x: 120, y: 4 }, { x: 120, y: 120 });
    const noisy: Point[] = [];
    clean.forEach((point, index) => {
      const wobble = index % 2 === 0 ? 1.5 : -1.5;
      noisy.push({ x: point.x + wobble, y: point.y - wobble });
    });
    assert.equal(recognizeCornerGesture(noisy), "page");
    assert.equal(recognizeCornerGesture([]), null);
    assert.equal(recognizeCornerGesture([{ x: 0, y: 0 }, { x: 80, y: 0 }]), null);
  });
});

describe("corner gesture pointer handling", () => {
  function host(): { doc: Document; actions: GestureAction[]; trails: Array<number | null> } {
    const { document } = parseHTML("<!doctype html><html><body><p id='text'>Select me</p></body></html>");
    return { doc: document, actions: [], trails: [] };
  }

  it("fires on right-button release and suppresses the context menu", () => {
    const { doc, actions, trails } = host();
    const stop = attachCornerGesture(doc, {
      isEnabled: () => true,
      onAction: (action) => actions.push(action),
      onTrail: (points) => trails.push(points ? points.length : null),
    });
    const span = T.minSegmentPx + 40;
    drag(doc, 2, elbow({ x: 8, y: 8 }, { x: 8 + span, y: 8 }, { x: 8 + span, y: 8 + span }), 2);
    assert.deepEqual(actions, ["page"]);
    assert.equal(trails.at(-1), null);
    assert.equal(contextMenu(doc), false);
    stop();
  });

  it("lets the context menu through when the stroke misses the threshold", () => {
    const { doc, actions } = host();
    const stop = attachCornerGesture(doc, {
      isEnabled: () => true,
      onAction: (action) => actions.push(action),
    });
    drag(doc, 2, line({ x: 4, y: 4 }, { x: 180, y: 8 }), 2);
    assert.deepEqual(actions, []);
    assert.equal(contextMenu(doc), true);
    drag(doc, 2, [{ x: 20, y: 20 }], 2);
    assert.equal(contextMenu(doc), true);
    stop();
  });

  it("does not steal a left-button drag or run when the switch is off", () => {
    const { doc, actions } = host();
    let enabled = true;
    const stop = attachCornerGesture(doc, {
      isEnabled: () => enabled,
      shouldIgnore: () => false,
      onAction: (action) => actions.push(action),
    });
    const span = T.minSegmentPx + 40;
    const path = elbow({ x: 6, y: 6 }, { x: 6, y: 6 + span }, { x: 6 + span, y: 6 + span });
    drag(doc, 0, path, 1);
    assert.deepEqual(actions, []);
    assert.equal(contextMenu(doc), true);

    enabled = false;
    drag(doc, 2, path, 2);
    assert.deepEqual(actions, []);
    assert.equal(contextMenu(doc), true);

    enabled = true;
    drag(doc, 2, path, 2);
    assert.deepEqual(actions, ["crop"]);
    assert.equal(contextMenu(doc), false);
    stop();
  });
});

describe("shortcut commands", () => {
  it("registers Alt+T and Alt+S as suggested keys", () => {
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as {
      version: string;
      permissions: string[];
      commands: Record<string, { description: string; suggested_key: { default: string; mac?: string } }>;
    };
    assert.equal(manifest.version, "0.1.9");
    assert.equal(manifest.permissions.includes("notifications"), true);
    const page = manifest.commands[PAGE_TRANSLATE_COMMAND];
    const crop = manifest.commands[CROP_OCR_COMMAND];
    assert.ok(page && crop);
    assert.equal(page?.suggested_key.default, SUGGESTED_PAGE_SHORTCUT);
    assert.equal(page?.suggested_key.mac, SUGGESTED_PAGE_SHORTCUT);
    assert.equal(crop?.suggested_key.default, SUGGESTED_CROP_SHORTCUT);
    assert.equal(crop?.suggested_key.mac, SUGGESTED_CROP_SHORTCUT);
    assert.match(page?.description ?? "", /整页/);
    assert.match(crop?.description ?? "", /识译|截图/);
    assert.equal(shortcutAction(PAGE_TRANSLATE_COMMAND), "page");
    assert.equal(shortcutAction(CROP_OCR_COMMAND), "crop");
    assert.equal(shortcutAction("_execute_action"), null);
  });

  it("prompts instead of delivering when the key is missing or the page cannot be injected", () => {
    const blocked = decideShortcut({
      command: PAGE_TRANSLATE_COMMAND,
      url: "chrome://extensions/",
      hasApiKey: true,
    });
    assert.equal(blocked?.deliver, false);
    assert.match(blocked?.notice?.message ?? "", /chrome:/);
    assert.match(blocked?.notice?.message ?? "", /不能整页翻译/);

    const edge = unavailablePageNotice("crop", "edge://settings/");
    assert.match(edge.message, /edge:/);
    assert.match(edge.message, /不能截图识译/);

    const noKey = decideShortcut({
      command: CROP_OCR_COMMAND,
      url: "https://example.com/article",
      hasApiKey: false,
    });
    assert.equal(noKey?.deliver, false);
    assert.match(noKey?.notice?.message ?? "", /API Key/);
    assert.match(noKey?.notice?.message ?? "", /不会假翻/);
    assert.match(missingKeyNotice("page").message, /不会假翻/);

    const ready = decideShortcut({
      command: PAGE_TRANSLATE_COMMAND,
      url: "https://example.com/article",
      hasApiKey: true,
    });
    assert.equal(ready?.deliver, true);
    assert.equal(ready?.notice, null);
    assert.equal(decideShortcut({ command: "unknown", url: "https://example.com", hasApiKey: true }), null);
  });

  it("defaults mouse gestures on and keeps the shortcut wiring in the extension", () => {
    assert.equal(defaultSettings().gestureEnabled, true);
    assert.equal(normalizeSettings({}).gestureEnabled, true);
    assert.equal(normalizeSettings({ gestureEnabled: false }).gestureEnabled, false);
    assert.equal(normalizeSettings({ gestureEnabled: "no" }).gestureEnabled, true);
    assert.equal(normalizeSettings({ gestureEnabled: false }).selectionEnabled, true);
    assert.equal(normalizeSettings({ gestureEnabled: false }).forceSelectEnabled, false);

    const background = readFileSync(new URL("../background/index.ts", import.meta.url), "utf8");
    const content = readFileSync(new URL("../content/index.ts", import.meta.url), "utf8");
    const gestureAt = content.indexOf("mountPageGesture(document");
    const forceAt = content.indexOf("createForceSelect(document");
    assert.ok(gestureAt >= 0 && forceAt > gestureAt);
    const popup = readFileSync(new URL("../popup/popup.html", import.meta.url), "utf8");
    assert.match(background, /chrome\.commands\.onCommand/);
    assert.match(background, /decideShortcut/);
    assert.match(background, /notifications\.create/);
    assert.match(content, /attachCornerGesture|mountPageGesture/);
    assert.match(content, /gestureEnabled/);
    assert.match(content, /shortcut-notice/);
    assert.match(popup, /Alt\+T/);
    assert.match(popup, /Alt\+S/);
    assert.match(popup, /启用鼠标手势/);
    const home = popup.slice(popup.indexOf('id="home-view"'), popup.indexOf('id="settings-view"'));
    const settings = popup.slice(popup.indexOf('id="settings-view"'), popup.indexOf('id="glossary-view"'));
    assert.equal(home.includes("源语言"), false);
    assert.equal(home.includes("划词模式"), false);
    assert.match(home, /划词翻译/);
    assert.match(home, /允许划选被禁文字/);
    assert.match(home, /术语本/);
    assert.match(home, /截图识译/);
    assert.equal(settings.includes('id="selection-toggle"'), false);
    assert.equal(settings.includes('id="force-select-toggle"'), false);
    assert.equal(settings.includes('id="open-glossary"'), false);
    assert.match(settings, /划词模式/);
    assert.match(settings, /id="gesture-toggle"/);
    assert.match(settings, /源语言/);
  });
});
