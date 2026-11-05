import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import {
  OCR_FONT_DEFAULT,
  OCR_FONT_MAX,
  OCR_FONT_MIN,
  OCR_PANEL_DEFAULT_WIDTH,
  OCR_PANEL_ENLARGED_WIDTH,
  OCR_PANEL_MIN_HEIGHT,
  OCR_PANEL_MIN_WIDTH,
  createOcrPanelLayout,
  createOcrPanelSession,
  dragOcrPanel,
  mountOcrPanel,
  ocrPanelChrome,
  ocrPanelPhase,
  refitOcrPanel,
  resizeOcrPanel,
  stepOcrPanelFont,
  toggleOcrPanelEnlarge,
  type OcrPanelController,
  type OcrPanelLayout,
  type OcrPanelModel,
} from "./ocr-panel.ts";

const view = { width: 1200, height: 800 };
const contentHeight = 300;

function open(height = contentHeight, viewport = view): OcrPanelLayout {
  return createOcrPanelLayout(viewport, height);
}

function point(window: { Event: new (type: string, init?: EventInit) => Event }, type: string, x: number, y: number): Event {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    button: { value: 0 },
    pointerId: { value: 1 },
  });
  return event;
}

describe("ocr panel layout", () => {
  it("opens at the bottom-right default size and 13px", () => {
    const layout = open();
    assert.equal(layout.enlarged, false);
    assert.equal(layout.moved, false);
    assert.equal(layout.fontPx, OCR_FONT_DEFAULT);
    assert.equal(layout.box.width, OCR_PANEL_DEFAULT_WIDTH);
    assert.equal(layout.box.height, contentHeight);
    assert.equal(layout.box.left, 1200 - 16 - OCR_PANEL_DEFAULT_WIDTH);
    assert.equal(layout.box.top, 800 - 16 - contentHeight);
    assert.deepEqual(layout.sessionDefault, layout.box);
  });

  it("clamps a title-bar drag inside the viewport and keeps the size", () => {
    const layout = open();
    const pushed = dragOcrPanel(layout, 800, 600, view);
    assert.equal(pushed.box.width, layout.box.width);
    assert.equal(pushed.box.height, layout.box.height);
    assert.equal(pushed.box.left + pushed.box.width, 1200 - 16);
    assert.equal(pushed.box.top + pushed.box.height, 800 - 16);
    assert.equal(pushed.moved, false);

    const pulled = dragOcrPanel(layout, -4000, -4000, view);
    assert.equal(pulled.box.left, 16);
    assert.equal(pulled.box.top, 16);
    assert.equal(pulled.moved, true);
    assert.equal(pulled.box.width, OCR_PANEL_DEFAULT_WIDTH);
    assert.equal(pulled.fontPx, OCR_FONT_DEFAULT);
    assert.equal(pulled.enlarged, false);

    const still = dragOcrPanel(layout, 0, 0, view);
    assert.equal(still.moved, false);
    assert.equal(still.box.left, layout.box.left);
  });

  it("resizes from edges and corners and clamps to the min size and the viewport", () => {
    const layout = open();
    const shrunk = resizeOcrPanel(layout, "w", 500, 0, view);
    assert.equal(shrunk.box.width, OCR_PANEL_MIN_WIDTH);
    assert.equal(shrunk.box.left + shrunk.box.width, layout.box.left + layout.box.width);
    assert.equal(shrunk.box.height, layout.box.height);

    const short = resizeOcrPanel(layout, "n", 0, 400, view);
    assert.equal(short.box.height, OCR_PANEL_MIN_HEIGHT);
    assert.equal(short.box.top + short.box.height, layout.box.top + layout.box.height);

    const wide = resizeOcrPanel({ ...layout, box: { ...layout.box, left: 16 } }, "e", 5000, 0, view);
    assert.equal(wide.box.left, 16);
    assert.equal(wide.box.width, 1200 - 32);
    assert.equal(wide.box.left + wide.box.width, 1200 - 16);

    const floating = { ...layout, box: { left: 200, top: 120, width: 400, height: 300 } };
    const corner = resizeOcrPanel(floating, "se", -40, 80, view);
    assert.equal(corner.box.width, 360);
    assert.equal(corner.box.height, 380);
    assert.equal(corner.box.left, 200);
    assert.equal(corner.box.top, 120);
    assert.equal(corner.moved, false);

    const tinyViewport = resizeOcrPanel(layout, "se", 20, 20, { width: 200, height: 160 });
    assert.ok(tinyViewport.box.width <= 200 - 32);
    assert.ok(tinyViewport.box.height <= 160 - 32);
    assert.ok(tinyViewport.box.left >= 16);
    assert.ok(tinyViewport.box.top >= 16);
    assert.ok(tinyViewport.box.left + tinyViewport.box.width <= 200 - 16);
  });

  it("toggles enlarge without changing font and restores the session default, not the dragged size", () => {
    let layout = stepOcrPanelFont(open(), 1);
    layout = stepOcrPanelFont(layout, 1);
    assert.equal(layout.fontPx, 15);
    const intermediate = resizeOcrPanel(resizeOcrPanel(layout, "w", 80, 0, view), "n", 0, 40, view);
    assert.equal(intermediate.box.width, OCR_PANEL_DEFAULT_WIDTH - 80);
    assert.equal(intermediate.box.height, contentHeight - 40);
    assert.equal(intermediate.moved, true);

    const enlarged = toggleOcrPanelEnlarge(intermediate, view);
    assert.equal(enlarged.enlarged, true);
    assert.equal(enlarged.fontPx, 15);
    assert.equal(enlarged.box.width, OCR_PANEL_ENLARGED_WIDTH);
    assert.equal(enlarged.box.height, contentHeight);
    assert.notEqual(enlarged.box.width, intermediate.box.width);

    const tuned = resizeOcrPanel(enlarged, "e", -30, 0, view);
    assert.equal(tuned.enlarged, true);
    assert.equal(tuned.box.width, OCR_PANEL_ENLARGED_WIDTH - 30);
    assert.equal(tuned.fontPx, 15);

    const restored = toggleOcrPanelEnlarge(tuned, view);
    assert.equal(restored.enlarged, false);
    assert.equal(restored.fontPx, 15);
    assert.equal(restored.box.width, layout.sessionDefault.width);
    assert.equal(restored.box.height, layout.sessionDefault.height);
    assert.notEqual(restored.box.width, tuned.box.width);
    assert.notEqual(restored.box.height, intermediate.box.height);
  });

  it("keeps a bottom-right panel in the corner when enlarging before any drag", () => {
    const layout = open();
    const enlarged = toggleOcrPanelEnlarge(layout, view);
    assert.equal(enlarged.moved, false);
    assert.equal(enlarged.box.width, OCR_PANEL_ENLARGED_WIDTH);
    assert.equal(enlarged.box.height, contentHeight);
    assert.equal(enlarged.box.left, 1200 - 16 - OCR_PANEL_ENLARGED_WIDTH);
    assert.equal(enlarged.box.top, layout.box.top);
    const restored = toggleOcrPanelEnlarge(enlarged, view);
    assert.deepEqual(restored.box, layout.box);
    assert.equal(restored.fontPx, OCR_FONT_DEFAULT);
  });

  it("steps font only inside 12–22 and does not change the box", () => {
    const layout = open();
    const down = stepOcrPanelFont(layout, -1);
    assert.equal(down.fontPx, OCR_FONT_MIN);
    assert.deepEqual(down.box, layout.box);
    assert.equal(stepOcrPanelFont(down, -1).fontPx, OCR_FONT_MIN);

    let grown = layout;
    for (let i = 0; i < 30; i += 1) grown = stepOcrPanelFont(grown, 1);
    assert.equal(grown.fontPx, OCR_FONT_MAX);
    assert.equal(grown.enlarged, false);
    assert.deepEqual(grown.box, layout.box);
    const enlarged = toggleOcrPanelEnlarge(grown, view);
    assert.equal(enlarged.fontPx, OCR_FONT_MAX);
    assert.equal(toggleOcrPanelEnlarge(enlarged, view).fontPx, OCR_FONT_MAX);
  });

  it("gives loading no drag, resize, font, or enlarge controls", () => {
    assert.equal(ocrPanelPhase(true), "loading");
    assert.equal(ocrPanelPhase(false), "ready");
    assert.deepEqual(ocrPanelChrome("loading"), { drag: false, resize: false, font: false, enlarge: false });
    assert.deepEqual(ocrPanelChrome("ready"), { drag: true, resize: true, font: true, enlarge: true });
  });

  it("resets position, size, font, and enlarge when the session closes and opens again", () => {
    const session = createOcrPanelSession();
    let layout = session.open(view, contentHeight);
    layout = session.commit(stepOcrPanelFont(layout, 1));
    layout = session.commit(dragOcrPanel(layout, -120, -80, view));
    layout = session.commit(toggleOcrPanelEnlarge(layout, view));
    assert.equal(layout.enlarged, true);
    assert.equal(layout.fontPx, 14);
    assert.equal(layout.moved, true);
    session.close();
    assert.equal(session.current(), null);
    const again = session.open(view, contentHeight);
    assert.equal(again.fontPx, OCR_FONT_DEFAULT);
    assert.equal(again.enlarged, false);
    assert.equal(again.moved, false);
    assert.deepEqual(again.box, open().box);
    assert.equal(again.box.width, OCR_PANEL_DEFAULT_WIDTH);
  });

  it("refits a clamped window without writing the layout anywhere durable", () => {
    const layout = open();
    const narrow = refitOcrPanel(layout, { width: 360, height: 500 });
    assert.ok(narrow.box.width <= 360 - 32);
    assert.ok(narrow.box.left >= 16);
    assert.equal(narrow.sessionDefault.width, OCR_PANEL_DEFAULT_WIDTH);
    assert.equal(narrow.fontPx, OCR_FONT_DEFAULT);
    const source = readFileSync(new URL("./ocr-panel.ts", import.meta.url), "utf8");
    assert.equal(source.includes("chrome.storage"), false);
    assert.equal(source.includes("localStorage"), false);
    const crop = readFileSync(new URL("../content/crop.ts", import.meta.url), "utf8");
    assert.equal(crop.includes("chrome.storage"), false);
    assert.equal(crop.includes("localStorage"), false);
  });
});

describe("ocr panel element", () => {
  function harness(phase: "loading" | "ready", layout = open()) {
    const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
    let current: OcrPanelLayout | null = phase === "ready" ? layout : null;
    const copies: string[] = [];
    let closed = 0;
    const model: OcrPanelModel = {
      phase,
      title: "截图识译",
      thumbLabel: phase === "ready" ? "选区缩略 · 420×168" : undefined,
      blocks: phase === "ready"
        ? [
            { label: "识别原文", text: "Visible sentence", translated: false },
            { label: "译文", text: "看得见的句子", translated: true },
          ]
        : [],
      error: phase === "ready" ? undefined : undefined,
      privacy: phase === "ready" ? "不改页面正文。" : undefined,
      sourceEnabled: phase === "ready",
      translationEnabled: phase === "ready",
      copySourceLabel: "复制原文",
      copyTranslationLabel: "复制译文",
    };
    const controller: OcrPanelController = {
      getLayout: () => current,
      viewport: () => view,
      onLayout: (next) => {
        current = next;
      },
      onClose: () => {
        closed += 1;
      },
      onCopySource: () => copies.push("source"),
      onCopyTranslation: () => copies.push("translation"),
    };
    const mounted = mountOcrPanel(document, model, controller);
    document.body.append(mounted.element);
    return { document, window, mounted, copies, get closed() { return closed; }, get layout() { return current; } };
  }

  it("renders a fixed loading panel without drag, resize, font, or enlarge", () => {
    const { mounted, window } = harness("loading");
    const panel = mounted.element;
    assert.equal(panel.dataset.phase, "loading");
    assert.equal(panel.querySelector(".handle"), null);
    assert.equal(panel.querySelector(".zoom-btn"), null);
    assert.equal(panel.querySelector(".fs-btn"), null);
    assert.equal(panel.querySelector(".drag-hint"), null);
    assert.equal(panel.querySelector(".ocr-hd")?.classList.contains("ready"), false);
    assert.match(panel.querySelector(".status")?.textContent ?? "", /正在识字/);
    assert.equal(panel.querySelector(".ocr-actions"), null);
    const head = panel.querySelector(".ocr-hd");
    assert.ok(head);
    head.dispatchEvent(point(window, "pointerdown", 40, 40));
    window.dispatchEvent(point(window, "pointermove", 10, 10));
    window.dispatchEvent(point(window, "pointerup", 10, 10));
    assert.equal(panel.querySelector("[aria-label='关闭']")?.tagName, "BUTTON");
  });

  it("drags, resizes, zooms font, and toggles enlarge on the result panel", () => {
    const ui = harness("ready");
    const panel = ui.mounted.element;
    assert.equal(panel.querySelectorAll(".handle").length, 8);
    assert.equal(panel.querySelector(".zoom-btn")?.textContent, "放大");
    assert.equal(panel.querySelector(".fs-range")?.textContent, "12–22");
    assert.equal(panel.dataset.font, "13");
    assert.equal(getComputedStyleSafe(panel), "13px");
    assert.match(panel.querySelector(".ocr-block .btext")?.textContent ?? "", /Visible sentence/);
    assert.equal(panel.querySelector(".blabel")?.getAttribute("style"), null);

    const title = panel.querySelector("h2");
    assert.ok(title);
    const startLeft = ui.layout?.box.left ?? 0;
    const startTop = ui.layout?.box.top ?? 0;
    title.dispatchEvent(point(ui.window, "pointerdown", 200, 200));
    ui.window.dispatchEvent(point(ui.window, "pointermove", 0, 140));
    ui.window.dispatchEvent(point(ui.window, "pointerup", 0, 140));
    assert.equal(ui.layout?.box.left, startLeft - 200);
    assert.equal(ui.layout?.box.top, startTop - 60);
    assert.equal(ui.layout?.moved, true);
    assert.equal(ui.layout?.fontPx, 13);

    const east = panel.querySelector(".handle.e");
    assert.ok(east);
    const widthBefore = ui.layout?.box.width ?? 0;
    east.dispatchEvent(point(ui.window, "pointerdown", 0, 0));
    ui.window.dispatchEvent(point(ui.window, "pointermove", 50, 0));
    ui.window.dispatchEvent(point(ui.window, "pointerup", 50, 0));
    assert.equal(ui.layout?.box.width, widthBefore + 50);

    const plus = panel.querySelector<HTMLButtonElement>(".fs-btn.plus");
    const minus = panel.querySelector<HTMLButtonElement>(".fs-btn.minus");
    assert.ok(plus && minus);
    plus.click();
    plus.click();
    assert.equal(ui.layout?.fontPx, 15);
    assert.equal(panel.dataset.font, "15");
    assert.equal(ui.layout?.box.width, widthBefore + 50);
    for (let i = 0; i < 20; i += 1) plus.click();
    assert.equal(ui.layout?.fontPx, OCR_FONT_MAX);
    assert.equal(plus.disabled, true);
    minus.click();
    assert.equal(ui.layout?.fontPx, OCR_FONT_MAX - 1);
    for (let i = 0; i < 30; i += 1) minus.click();
    assert.equal(ui.layout?.fontPx, OCR_FONT_MIN);
    assert.equal(minus.disabled, true);

    const fontBeforeEnlarge = ui.layout?.fontPx;
    const zoom = panel.querySelector<HTMLButtonElement>(".zoom-btn");
    assert.ok(zoom);
    zoom.click();
    assert.equal(zoom.textContent, "还原");
    assert.equal(zoom.classList.contains("on"), true);
    assert.equal(ui.layout?.enlarged, true);
    assert.equal(ui.layout?.box.width, OCR_PANEL_ENLARGED_WIDTH);
    assert.equal(ui.layout?.box.height, contentHeight);
    assert.equal(ui.layout?.fontPx, fontBeforeEnlarge);
    zoom.click();
    assert.equal(zoom.textContent, "放大");
    assert.equal(ui.layout?.enlarged, false);
    assert.equal(ui.layout?.box.width, OCR_PANEL_DEFAULT_WIDTH);
    assert.equal(ui.layout?.box.height, contentHeight);
    assert.equal(ui.layout?.fontPx, fontBeforeEnlarge);

    panel.querySelector<HTMLButtonElement>(".btn.primary")?.click();
    panel.querySelector<HTMLButtonElement>(".ocr-actions .btn")?.click();
    assert.deepEqual(ui.copies, ["translation", "source"]);
    panel.querySelector<HTMLButtonElement>(".ocr-hd .close")?.click();
    assert.equal(ui.closed, 1);
    assert.equal(ui.document.documentElement.style.fontSize, "");
    assert.equal(ui.document.querySelector("h2")?.getAttribute("style"), null);
  });

  it("keeps enlarge and font off the page and available after a failed result", () => {
    const { document } = parseHTML("<!doctype html><html><body><p id='page'>Page text</p></body></html>");
    let current: OcrPanelLayout | null = open();
    const mounted = mountOcrPanel(document, {
      phase: "ready",
      title: "截图识译",
      blocks: [{ label: "识别原文", text: "only source", translated: false }],
      errorTitle: "识译失败",
      error: "不会假翻。页面正文没有改动。",
      privacy: "不改页面正文。",
      sourceEnabled: true,
      translationEnabled: false,
      copySourceLabel: "复制原文",
      copyTranslationLabel: "复制译文",
    }, {
      getLayout: () => current,
      viewport: () => view,
      onLayout: (next) => {
        current = next;
      },
      onClose: () => undefined,
    });
    document.body.append(mounted.element);
    assert.match(mounted.element.querySelector(".err")?.textContent ?? "", /不会假翻/);
    assert.equal(mounted.element.querySelector<HTMLButtonElement>(".btn.primary")?.disabled, true);
    mounted.element.querySelector<HTMLButtonElement>(".zoom-btn")?.click();
    assert.equal(current?.enlarged, true);
    assert.equal(current?.fontPx, 13);
    assert.equal(document.querySelector("#page")?.getAttribute("style"), null);
    assert.equal(document.documentElement.style.fontSize, "");
  });
});

function getComputedStyleSafe(panel: HTMLElement): string {
  return panel.style.getPropertyValue("--ocr-font");
}
