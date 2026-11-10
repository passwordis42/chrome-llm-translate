import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import {
  SELECTION_FLOAT_DEFAULT_WIDTH,
  SELECTION_FLOAT_DEFAULT_WIDTH_CSS,
  SELECTION_FLOAT_DRAG_LABEL,
  SELECTION_FLOAT_ENLARGED_WIDTH,
  SELECTION_FLOAT_ENLARGED_WIDTH_CSS,
  SELECTION_FLOAT_FONT_PX,
  SELECTION_FLOAT_MAX_HEIGHT_CSS,
  SELECTION_FLOAT_MARGIN,
  createSelectionFloatSession,
  dragSelectionFloat,
  mountSelectionFloatShell,
  noteSelectionFloatContent,
  placeSelectionFloat,
  selectionFloatHeight,
  selectionFloatMaxHeight,
  selectionFloatWidth,
  toggleSelectionFloatEnlarge,
  type SelectionFloatController,
  type SelectionFloatLayout,
  type SelectionFloatShell,
} from "./selection-float.ts";

const view = { width: 1200, height: 800 };
const maxHeight = selectionFloatMaxHeight(view.height);

function layout(partial: Partial<SelectionFloatLayout> = {}): SelectionFloatLayout {
  return {
    left: 120,
    top: 140,
    enlarged: false,
    moved: false,
    contentHeight: 220,
    ...partial,
  };
}

function point(window: { Event: new (type: string, init?: EventInit) => Event }, type: string, x: number, y: number, button = 0): Event {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    button: { value: button },
    pointerId: { value: 1 },
  });
  return event;
}

describe("selection float size", () => {
  it("keeps short text at content height and caps long text inside the viewport", () => {
    const short = selectionFloatHeight(220, view.height, false);
    assert.equal(short.height, 220);
    assert.equal(short.scrolls, false);
    assert.ok(short.height < maxHeight);

    const long = selectionFloatHeight(2400, view.height, false);
    assert.equal(long.height, maxHeight);
    assert.equal(long.height, view.height - 48);
    assert.equal(long.scrolls, true);

    const streamed = selectionFloatHeight(8000, view.height, false);
    assert.equal(streamed.height, long.height);
    assert.equal(streamed.scrolls, true);

    assert.equal(selectionFloatWidth(view.width, false), SELECTION_FLOAT_DEFAULT_WIDTH);
    assert.equal(selectionFloatWidth(360, false), 360 - 16);
    assert.equal(selectionFloatWidth(view.width, true), SELECTION_FLOAT_ENLARGED_WIDTH);
    assert.equal(selectionFloatWidth(500, true), 500 - 48);
  });

  it("enlarges to the preset viewport size and restores the default tier without a font change", () => {
    const anchor = { left: 48, top: 64 };
    const start = placeSelectionFloat(layout(), anchor, view);
    assert.equal(start.enlarged, false);
    assert.equal(selectionFloatWidth(view.width, false), 380);
    assert.equal(selectionFloatHeight(start.contentHeight, view.height, false).height, 220);

    const enlarged = toggleSelectionFloatEnlarge(start, view, anchor);
    assert.equal(enlarged.enlarged, true);
    assert.equal(enlarged.moved, false);
    assert.equal(selectionFloatWidth(view.width, true), 640);
    assert.equal(selectionFloatHeight(enlarged.contentHeight, view.height, true).height, maxHeight);
    assert.equal(SELECTION_FLOAT_FONT_PX, 13);
    assert.ok(enlarged.left >= SELECTION_FLOAT_MARGIN);
    assert.ok(enlarged.top >= SELECTION_FLOAT_MARGIN);
    assert.ok(enlarged.left + 640 <= view.width - SELECTION_FLOAT_MARGIN);
    assert.ok(enlarged.top + maxHeight <= view.height - SELECTION_FLOAT_MARGIN);

    const restored = toggleSelectionFloatEnlarge(enlarged, view, anchor);
    assert.equal(restored.enlarged, false);
    assert.equal(restored.moved, false);
    assert.equal(selectionFloatHeight(restored.contentHeight, view.height, false).height, 220);
    assert.equal(restored.left, anchor.left);
    assert.equal(restored.top, anchor.top);
    assert.equal(SELECTION_FLOAT_FONT_PX, 13);
  });
});

describe("selection float drag", () => {
  it("clamps a title-bar drag inside the viewport and does not resize", () => {
    const start = layout();
    const pushed = dragSelectionFloat(start, 5000, 5000, view);
    assert.equal(pushed.left, view.width - SELECTION_FLOAT_DEFAULT_WIDTH - SELECTION_FLOAT_MARGIN);
    assert.equal(pushed.top, view.height - start.contentHeight - SELECTION_FLOAT_MARGIN);
    assert.equal(pushed.moved, true);
    assert.equal(pushed.enlarged, false);
    assert.equal(selectionFloatWidth(view.width, pushed.enlarged), SELECTION_FLOAT_DEFAULT_WIDTH);
    assert.equal(selectionFloatHeight(pushed.contentHeight, view.height, false).height, start.contentHeight);

    const pulled = dragSelectionFloat(start, -5000, -5000, view);
    assert.equal(pulled.left, SELECTION_FLOAT_MARGIN);
    assert.equal(pulled.top, SELECTION_FLOAT_MARGIN);
    assert.equal(pulled.moved, true);

    const still = dragSelectionFloat(start, 0, 0, view);
    assert.equal(still.moved, false);
    assert.equal(still.left, start.left);
    assert.equal(still.top, start.top);
  });

  it("does not snap back to the selection when streamed text grows after a drag", () => {
    const anchor = { left: 700, top: 640 };
    let current = dragSelectionFloat(layout({ left: 120, top: 140, contentHeight: 220 }), 50, 40, view);
    assert.equal(current.moved, true);
    assert.equal(current.left, 170);
    assert.equal(current.top, 180);

    current = noteSelectionFloatContent(current, 260, view);
    assert.equal(current.left, 170);
    assert.equal(current.top, 180);
    assert.equal(selectionFloatHeight(current.contentHeight, view.height, false).height, 260);
    assert.notDeepEqual({ left: current.left, top: current.top }, anchor);

    current = noteSelectionFloatContent(current, 5000, view);
    assert.equal(current.moved, true);
    assert.equal(current.enlarged, false);
    assert.equal(current.left, 170);
    assert.equal(current.top, view.height - maxHeight - SELECTION_FLOAT_MARGIN);
    assert.notEqual(current.top, anchor.top);
    assert.equal(selectionFloatHeight(current.contentHeight, view.height, false).height, maxHeight);

    const again = noteSelectionFloatContent(current, 9000, view);
    assert.equal(again.left, current.left);
    assert.equal(again.top, current.top);
    assert.equal(selectionFloatHeight(again.contentHeight, view.height, false).height, maxHeight);
  });

  it("keeps the dragged origin while enlarged, and streaming stays on that tier", () => {
    const dragged = dragSelectionFloat(layout({ left: 200, top: 80 }), -40, 24, view);
    const enlarged = toggleSelectionFloatEnlarge(dragged, view, { left: 12, top: 12 });
    assert.equal(enlarged.enlarged, true);
    assert.equal(enlarged.moved, true);
    assert.equal(enlarged.left, dragged.left);
    assert.notEqual(enlarged.left, 12);
    assert.equal(selectionFloatHeight(enlarged.contentHeight, view.height, true).height, maxHeight);

    const streamed = noteSelectionFloatContent(enlarged, 12000, view);
    assert.equal(streamed.enlarged, true);
    assert.equal(streamed.moved, true);
    assert.equal(streamed.left, enlarged.left);
    assert.equal(streamed.top, enlarged.top);
    assert.equal(selectionFloatHeight(streamed.contentHeight, view.height, true).height, maxHeight);
    assert.equal(SELECTION_FLOAT_FONT_PX, 13);

    const restored = toggleSelectionFloatEnlarge(streamed, view, { left: 12, top: 12 });
    assert.equal(restored.enlarged, false);
    assert.equal(restored.moved, true);
    assert.equal(restored.left, streamed.left);
    assert.notEqual(restored.left, 12);
    assert.equal(selectionFloatHeight(restored.contentHeight, view.height, false).height, maxHeight);
  });
});

describe("selection float session", () => {
  it("drops position, size tier, and enlarge when closed, including the next selection", () => {
    const session = createSelectionFloatSession();
    let current = session.open({ left: 30, top: 40 }, 200);
    current = session.commit(dragSelectionFloat(current, 80, 60, view));
    current = session.commit(toggleSelectionFloatEnlarge(current, view, null));
    assert.equal(current.moved, true);
    assert.equal(current.enlarged, true);

    session.close();
    assert.equal(session.current(), null);

    const again = session.open({ left: 24, top: 36 }, 180);
    assert.equal(again.left, 24);
    assert.equal(again.top, 36);
    assert.equal(again.enlarged, false);
    assert.equal(again.moved, false);
    assert.equal(again.contentHeight, 180);
    assert.equal(selectionFloatHeight(again.contentHeight, view.height, false).height, 180);
  });

  it("does not persist the float in storage and does not add resize or font controls", () => {
    const source = readFileSync(new URL("./selection-float.ts", import.meta.url), "utf8");
    const floatSource = readFileSync(new URL("../content/float.ts", import.meta.url), "utf8");
    const ocr = readFileSync(new URL("./ocr-panel.ts", import.meta.url), "utf8");
    for (const file of [source, floatSource]) {
      assert.equal(file.includes("chrome.storage"), false);
      assert.equal(file.includes("localStorage"), false);
      assert.equal(file.includes("sessionStorage"), false);
      assert.equal(file.includes("A−"), false);
      assert.equal(file.includes("A+"), false);
      assert.equal(file.includes("fs-btn"), false);
      assert.equal(file.includes("resizeOcrPanel"), false);
    }
    assert.match(source, /SELECTION_FLOAT_GRIP = "\\u28FF"/);
    assert.equal(source.includes("⠿"), false);
    assert.equal(source.includes("⣹"), false);
    assert.equal(source.includes("dashed"), false);
    assert.match(ocr, /grip", "⠿"/);
    assert.match(ocr, /resizeOcrPanel/);
    assert.match(ocr, /A−/);
    assert.match(floatSource, /noteSelectionFloatContent/);
    assert.match(floatSource, /draft\.moved \? null : selectionAnchor/);
    assert.match(floatSource, /session\.close\(\)/);
    const onTextAt = floatSource.indexOf("onText:");
    const onText = floatSource.slice(onTextAt, onTextAt + 500);
    assert.match(onText, /syncContentBounds/);
    assert.equal(onText.includes("computeFloatPosition"), false);
    assert.match(floatSource, /shell\.pair\.append/);
    assert.match(floatSource, /shell\.tip\.append\(langRow, actions\)/);
  });
});

describe("selection float chrome", () => {
  function harness(): {
    document: Document;
    window: Window & { Event: typeof Event };
    shell: SelectionFloatShell;
    host: HTMLDivElement;
    getLayout: () => SelectionFloatLayout | null;
    closed: () => number;
  } {
    const { document, window } = parseHTML("<!doctype html><html><body><p id='page'>Page</p></body></html>");
    const session = createSelectionFloatSession();
    session.open({ left: 160, top: 120 }, 220);
    const host = document.createElement("div");
    host.id = "yifan-float";
    host.dataset.font = String(SELECTION_FLOAT_FONT_PX);
    let closed = 0;
    let shell: SelectionFloatShell | null = null;
    const controller: SelectionFloatController = {
      getLayout: () => session.current(),
      viewport: () => view,
      contentHeight: () => session.current()?.contentHeight ?? 220,
      anchor: () => ({ left: 48, top: 64 }),
      onLayout: (next) => {
        session.commit(next);
        shell?.apply(next);
        host.classList.toggle("is-enlarged", next.enlarged);
        host.dataset.enlarged = next.enlarged ? "true" : "false";
        host.dataset.moved = next.moved ? "true" : "false";
        host.dataset.font = String(SELECTION_FLOAT_FONT_PX);
      },
      onClose: () => {
        closed += 1;
        session.close();
      },
    };
    const brand = document.createElement("span");
    brand.className = "brand-mini";
    brand.textContent = "一翻 · 划词";
    shell = mountSelectionFloatShell(document, controller, brand);
    const src = document.createElement("div");
    src.className = "src";
    src.textContent = "When a sentence matters, you can select it.";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "目标语言");
    const option = document.createElement("option");
    option.textContent = "中文";
    select.append(option);
    const langRow = document.createElement("div");
    langRow.className = "lang-row";
    langRow.append(select);
    const actions = document.createElement("div");
    actions.className = "actions";
    for (const label of ["复制译文", "改语言", "关闭"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = label;
      actions.append(button);
    }
    shell.pair.append(src);
    shell.tip.append(langRow, actions);
    if (!shell) throw new Error("划词浮层没有挂上");
    document.body.append(host, shell.tip);
    shell.apply(session.current());
    return {
      document,
      window: window as Window & { Event: typeof Event },
      shell,
      host,
      getLayout: () => session.current(),
      closed: () => closed,
    };
  }

  it("scrolls the body and keeps the footer pinned, with the grip, enlarge, chip, and close", () => {
    const ui = harness();
    const { tip, head, pair } = ui.shell;
    const actions = tip.querySelector(".actions");
    const langRow = tip.querySelector(".lang-row");
    assert.ok(actions && langRow);
    assert.equal(actions.parentElement, tip);
    assert.equal(langRow.parentElement, tip);
    assert.equal(pair.contains(actions), false);
    assert.equal(pair.nextElementSibling, langRow);
    assert.equal(langRow.nextElementSibling, actions);
    assert.equal(head.querySelector(".drag-hint")?.textContent, SELECTION_FLOAT_DRAG_LABEL);
    assert.equal(head.querySelector(".grip")?.textContent?.codePointAt(0), 0x28ff);
    assert.equal(head.textContent?.includes("⣹"), false);
    assert.equal(head.textContent?.includes("⠿"), false);
    assert.equal(head.querySelector(".zoom-btn")?.textContent, "放大");
    assert.equal(head.querySelector(".lang")?.className, "lang");
    assert.equal(head.querySelector(".close")?.getAttribute("aria-label"), "关闭");
    assert.equal(head.textContent?.includes("一翻 · 划词"), true);
    assert.equal(tip.querySelector(".handle"), null);
    assert.equal(tip.querySelector(".fs-btn"), null);
    assert.equal(tip.querySelector(".fs-ctrl"), null);
    assert.equal(tip.textContent?.includes("A−"), false);
    assert.equal(tip.textContent?.includes("A+"), false);
    assert.equal(tip.innerHTML.includes("dashed"), false);

    const css = readFileSync(new URL("../content/content.css", import.meta.url), "utf8");
    assert.ok(css.includes(SELECTION_FLOAT_DEFAULT_WIDTH_CSS));
    assert.ok(css.includes(SELECTION_FLOAT_ENLARGED_WIDTH_CSS));
    assert.ok(css.includes(SELECTION_FLOAT_MAX_HEIGHT_CSS));
    const hostCss = css.match(/:host\(#yifan-float\)\s*\{[^}]*\}/)?.[0] ?? "";
    const enlargedCss = css.match(/:host\(#yifan-float\.is-enlarged\)\s*\{[^}]*\}/)?.[0] ?? "";
    assert.match(hostCss, /--float-font:\s*13px/);
    assert.match(hostCss, /max-height:\s*calc\(100vh - 48px\)/);
    assert.equal(hostCss.replace(/max-height:[^;]+;/, "").includes("height:"), false);
    assert.match(enlargedCss, /height:\s*calc\(100vh - 48px\)/);
    assert.equal(enlargedCss.includes("font-size"), false);
    assert.equal(enlargedCss.includes("--float-font"), false);
    const pairCss = css.match(/\.pair\s*\{[^}]*\}/)?.[0] ?? "";
    assert.match(pairCss, /overflow:\s*auto/);
    assert.match(pairCss, /min-height:\s*0/);
    assert.match(pairCss, /user-select:\s*text/);
    const srcCss = css.match(/\.src\s*\{[^}]*\}/)?.[0] ?? "";
    assert.match(srcCss, /var\(--float-font,\s*13px\)/);
    assert.equal(srcCss.includes("max-height"), false);
    const actionsCss = css.match(/\.actions\s*\{[^}]*\}/)?.[0] ?? "";
    assert.match(actionsCss, /flex-shrink:\s*0/);
    const dragging = css.match(/\.tip-hd\.dragging\s*\{[^}]*\}/)?.[0] ?? "";
    assert.match(dragging, /cursor:\s*grabbing/);
    assert.equal(dragging.includes("dashed"), false);
    assert.equal(dragging.includes("outline"), false);
  });

  it("drags from the title bar, but not from buttons, the language select, or in-window text", () => {
    const ui = harness();
    const head = ui.shell.head;
    const startLeft = ui.getLayout()?.left ?? 0;
    const startTop = ui.getLayout()?.top ?? 0;
    const before = ui.shell.tip.querySelectorAll("*").length;

    const zoom = head.querySelector<HTMLButtonElement>(".zoom-btn");
    assert.ok(zoom);
    zoom.dispatchEvent(point(ui.window, "pointerdown", 20, 20));
    ui.window.dispatchEvent(point(ui.window, "pointermove", 80, 90));
    ui.window.dispatchEvent(point(ui.window, "pointerup", 80, 90));
    assert.equal(ui.getLayout()?.left, startLeft);
    assert.equal(ui.getLayout()?.top, startTop);
    assert.equal(ui.getLayout()?.moved, false);
    assert.equal(head.classList.contains("dragging"), false);

    head.querySelector(".close")?.dispatchEvent(point(ui.window, "pointerdown", 4, 4));
    ui.window.dispatchEvent(point(ui.window, "pointermove", 40, 50));
    ui.window.dispatchEvent(point(ui.window, "pointerup", 40, 50));
    assert.equal(ui.getLayout()?.moved, false);

    const select = ui.shell.tip.querySelector("select");
    assert.ok(select);
    select.dispatchEvent(point(ui.window, "pointerdown", 8, 8));
    ui.window.dispatchEvent(point(ui.window, "pointermove", 80, 80));
    ui.window.dispatchEvent(point(ui.window, "pointerup", 80, 80));
    assert.equal(ui.getLayout()?.moved, false);

    const src = ui.shell.pair.querySelector(".src");
    assert.ok(src);
    const mouse = new ui.window.Event("mousedown", { bubbles: true, cancelable: true });
    src.dispatchEvent(mouse);
    assert.equal(mouse.defaultPrevented, false);
    src.dispatchEvent(point(ui.window, "pointerdown", 12, 30));
    ui.window.dispatchEvent(point(ui.window, "pointermove", 140, 180));
    ui.window.dispatchEvent(point(ui.window, "pointerup", 140, 180));
    assert.equal(ui.getLayout()?.left, startLeft);
    assert.equal(ui.getLayout()?.moved, false);
    assert.equal(src.getAttribute("style"), null);

    const copy = ui.shell.tip.querySelector(".actions .btn");
    assert.ok(copy);
    copy.dispatchEvent(point(ui.window, "pointerdown", 6, 6));
    ui.window.dispatchEvent(point(ui.window, "pointermove", 90, 90));
    ui.window.dispatchEvent(point(ui.window, "pointerup", 90, 90));
    assert.equal(ui.getLayout()?.moved, false);

    head.querySelector(".drag-hint")?.dispatchEvent(point(ui.window, "pointerdown", 200, 200));
    assert.equal(head.classList.contains("dragging"), true);
    ui.window.dispatchEvent(point(ui.window, "pointermove", 230, 250));
    ui.window.dispatchEvent(point(ui.window, "pointerup", 230, 250));
    assert.equal(head.classList.contains("dragging"), false);
    assert.equal(ui.getLayout()?.moved, true);
    assert.equal(ui.getLayout()?.left, startLeft + 30);
    assert.equal(ui.getLayout()?.top, startTop + 50);
    assert.equal(ui.shell.tip.querySelectorAll("*").length, before);
    assert.equal(ui.shell.tip.innerHTML.includes("dashed"), false);
    assert.equal(ui.document.querySelector("#page")?.getAttribute("style"), null);
  });

  it("enlarges and restores from the title button without changing the 13px font, including the error body", () => {
    const ui = harness();
    const err = ui.document.createElement("div");
    err.className = "err";
    err.textContent = "翻译失败";
    ui.shell.pair.append(err);
    const zoom = ui.shell.head.querySelector<HTMLButtonElement>(".zoom-btn");
    assert.ok(zoom);
    const src = ui.shell.pair.querySelector<HTMLElement>(".src");
    assert.equal(src?.style.fontSize, "");
    assert.equal(ui.host.dataset.font, "13");

    zoom.click();
    assert.equal(zoom.textContent, "还原");
    assert.equal(zoom.classList.contains("on"), true);
    assert.equal(ui.getLayout()?.enlarged, true);
    assert.equal(ui.host.classList.contains("is-enlarged"), true);
    assert.equal(ui.host.dataset.font, "13");
    assert.equal(src?.style.fontSize, "");
    assert.equal(selectionFloatWidth(view.width, true), 640);
    assert.equal(selectionFloatHeight(ui.getLayout()?.contentHeight ?? 0, view.height, true).height, maxHeight);

    zoom.click();
    assert.equal(zoom.textContent, "放大");
    assert.equal(zoom.classList.contains("on"), false);
    assert.equal(ui.getLayout()?.enlarged, false);
    assert.equal(ui.host.dataset.font, "13");
    assert.equal(SELECTION_FLOAT_FONT_PX, 13);
    assert.equal(ui.shell.tip.querySelector(".handle"), null);
    assert.equal(ui.shell.tip.querySelector(".fs-btn"), null);
  });

  it("resets enlarge after close and can drag again on a new selection", () => {
    const ui = harness();
    ui.shell.head.querySelector<HTMLButtonElement>(".zoom-btn")?.click();
    assert.equal(ui.getLayout()?.enlarged, true);
    ui.shell.head.querySelector<HTMLButtonElement>(".close")?.click();
    assert.equal(ui.closed(), 1);
    assert.equal(ui.getLayout(), null);

    const session = createSelectionFloatSession();
    const again = session.open({ left: 18, top: 28 }, 200);
    ui.shell.apply(again);
    assert.equal(again.enlarged, false);
    assert.equal(again.moved, false);
    assert.equal(ui.shell.head.querySelector(".zoom-btn")?.textContent, "放大");
    assert.equal(ui.shell.head.querySelector(".zoom-btn")?.classList.contains("on"), false);
  });
});
