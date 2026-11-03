import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import {
  FORCE_SELECT_MARK,
  FORCE_SELECT_STYLE_ID,
  createForceSelect,
  forceSelectCss,
  writeForceSelectInline,
} from "./force-select.ts";
import { defaultSettings, normalizeSettings } from "./settings.ts";

const BANNED = `<!doctype html><html><head><style>p.review-item-post { user-select: none; }</style></head><body>
  <p class="review-item-post" id="post" style="color: #333; user-select: none; -webkit-user-select: none">医生能看见但划不到</p>
  <div id="yifan-float" data-yifan-ignore style="user-select: auto"><span id="chrome">浮层</span></div>
  <input id="field" value="keep" />
</body></html>`;

describe("force select setting", () => {
  it("defaults off and only turns on for a real boolean true", () => {
    assert.equal(defaultSettings().forceSelectEnabled, false);
    assert.equal(normalizeSettings({}).forceSelectEnabled, false);
    assert.equal(normalizeSettings({ selectionEnabled: true }).forceSelectEnabled, false);
    assert.equal(normalizeSettings({ forceSelectEnabled: false }).forceSelectEnabled, false);
    assert.equal(normalizeSettings({ forceSelectEnabled: "yes" }).forceSelectEnabled, false);
    assert.equal(normalizeSettings({ forceSelectEnabled: true }).forceSelectEnabled, true);
    assert.equal(normalizeSettings({ forceSelectEnabled: true }).selectionEnabled, true);
    assert.equal(normalizeSettings({ forceSelectEnabled: true }).selectionMode, "confirm");
  });
});

describe("force select stylesheet", () => {
  it("forces user-select text, including the webkit prefix, with enough specificity for a class ban", () => {
    const css = forceSelectCss();
    assert.match(css, /-webkit-user-select:\s*text\s*!important/);
    assert.match(css, /-moz-user-select:\s*text\s*!important/);
    assert.match(css, /-ms-user-select:\s*text\s*!important/);
    assert.match(css, /(?<!-)user-select:\s*text\s*!important/);
    assert.match(css, /html body \[class\]/);
    const calls: Array<[string, string, string | undefined]> = [];
    writeForceSelectInline({
      setProperty(property, value, priority) {
        calls.push([property, value, priority]);
      },
    });
    assert.deepEqual(calls.map((call) => call[2]), ["important", "important", "important", "important"]);
    assert.equal(calls.some((call) => call[0] === "user-select" && call[1] === "text"), true);
    assert.equal(calls.some((call) => call[0] === "-webkit-user-select" && call[1] === "text"), true);
  });
});

describe("force select on a banned paragraph", () => {
  it("makes p.review-item-post selectable and restores the site style when turned off", async () => {
    const { document, window } = parseHTML(BANNED);
    const post = document.querySelector<HTMLElement>("#post");
    const chromeText = document.querySelector<HTMLElement>("#chrome");
    assert.ok(post && chromeText);
    let mouseDowns = 0;
    let mouseUps = 0;
    const armed = createForceSelect(document, {
      onForcedMouseDown() {
        mouseDowns += 1;
      },
      onForcedMouseUp() {
        mouseUps += 1;
      },
    });
    assert.equal(armed.isEnabled(), false);
    assert.equal(document.getElementById(FORCE_SELECT_STYLE_ID), null);
    assert.equal(post.style.getPropertyValue("user-select"), "none");

    let pageBlocked = false;
    window.addEventListener("selectstart", (event) => {
      pageBlocked = true;
      event.preventDefault();
    }, true);
    armed.setEnabled(true);

    assert.equal(armed.isEnabled(), true);
    const style = document.getElementById(FORCE_SELECT_STYLE_ID);
    assert.ok(style);
    assert.match(style.textContent ?? "", /user-select:\s*text\s*!important/);
    assert.equal(post.style.getPropertyValue("user-select"), "text");
    assert.equal(post.style.getPropertyValue("-webkit-user-select"), "text");
    assert.equal(post.style.getPropertyValue("color"), "#333");
    assert.equal(post.hasAttribute(FORCE_SELECT_MARK), true);
    assert.equal(post.textContent, "医生能看见但划不到");
    assert.equal(chromeText.hasAttribute(FORCE_SELECT_MARK), false);
    assert.equal(chromeText.style.getPropertyValue("user-select"), "");
    assert.equal(document.querySelector("#yifan-float")?.getAttribute("style"), "user-select: auto");

    const blocked = new window.Event("selectstart", { bubbles: true, cancelable: true });
    window.dispatchEvent(blocked);
    assert.equal(pageBlocked, false);
    assert.equal(blocked.defaultPrevented, false);

    const copy = new window.Event("copy", { bubbles: true, cancelable: true });
    let copyBlocked = false;
    window.addEventListener("copy", (event) => {
      copyBlocked = true;
      event.preventDefault();
    }, true);
    window.dispatchEvent(copy);
    assert.equal(copyBlocked, false);

    const down = new window.Event("mousedown", { bubbles: true, cancelable: true });
    window.dispatchEvent(down);
    assert.equal(mouseDowns, 1);

    const up = new window.Event("mouseup", { bubbles: true, cancelable: true });
    window.dispatchEvent(up);
    assert.equal(mouseUps, 1);

    const secondary = new window.Event("mouseup", { bubbles: true, cancelable: true });
    Object.defineProperty(secondary, "button", { value: 2 });
    window.dispatchEvent(secondary);
    assert.equal(mouseUps, 1);

    const field = document.querySelector<HTMLInputElement>("#field");
    assert.ok(field);
    let fieldHeard = false;
    window.addEventListener("mousedown", () => {
      fieldHeard = true;
    }, true);
    field.dispatchEvent(new window.Event("mousedown", { bubbles: true, cancelable: true }));
    assert.equal(fieldHeard, true);

    const host = document.querySelector<HTMLElement>("#yifan-float");
    assert.ok(host);
    let uiHeard = false;
    window.addEventListener("mousedown", () => {
      uiHeard = true;
    }, true);
    host.dispatchEvent(new window.Event("mousedown", { bubbles: true, cancelable: true }));
    assert.equal(uiHeard, true);

    post.style.setProperty("user-select", "none");
    post.className = "review-item-post";
    await Promise.resolve();
    assert.equal(post.style.getPropertyValue("user-select"), "text");

    const extra = document.createElement("p");
    extra.className = "review-item-post";
    extra.textContent = "后插入的禁选正文";
    extra.style.setProperty("user-select", "none");
    document.body?.append(extra);
    await Promise.resolve();
    assert.equal(extra.style.getPropertyValue("user-select"), "text");
    assert.equal(extra.hasAttribute(FORCE_SELECT_MARK), true);

    armed.setEnabled(false);
    assert.equal(armed.isEnabled(), false);
    assert.equal(document.getElementById(FORCE_SELECT_STYLE_ID), null);
    assert.equal(post.hasAttribute(FORCE_SELECT_MARK), false);
    assert.equal(extra.hasAttribute(FORCE_SELECT_MARK), false);
    assert.equal(post.style.getPropertyValue("user-select"), "none");
    assert.equal(post.style.getPropertyValue("-webkit-user-select"), "none");
    assert.equal(post.style.getPropertyValue("color"), "#333");
    assert.equal(post.textContent, "医生能看见但划不到");

    pageBlocked = false;
    const again = new window.Event("selectstart", { bubbles: true, cancelable: true });
    window.dispatchEvent(again);
    assert.equal(pageBlocked, true);
    assert.equal(again.defaultPrevented, true);

    const late = document.createElement("p");
    late.className = "review-item-post";
    late.style.setProperty("user-select", "none");
    document.body?.append(late);
    assert.equal(late.style.getPropertyValue("user-select"), "none");
    assert.equal(late.hasAttribute(FORCE_SELECT_MARK), false);
  });
});

describe("force select settings ui", () => {
  it("places the approved off-by-default switch between selection mode and the glossary", () => {
    const html = readFileSync(new URL("../popup/popup.html", import.meta.url), "utf8");
    const css = readFileSync(new URL("../popup/popup.css", import.meta.url), "utf8");
    const { document } = parseHTML(html);
    const toggle = document.querySelector<HTMLButtonElement>("#force-select-toggle");
    const row = toggle?.closest(".toggle-row");
    assert.ok(toggle && row);
    assert.equal(toggle.getAttribute("aria-checked"), "false");
    assert.equal(toggle.getAttribute("aria-label"), "允许划选被禁文字，已关闭");
    assert.equal(row.querySelector(".new-tag")?.textContent, "新");
    assert.equal(row.querySelector(".t-title")?.textContent, "允许划选被禁文字新");
    assert.equal(row.querySelector(".t-desc")?.textContent, "站点禁划选时强制放开，方便划词；默认关，进禁选页再开");
    const body = document.querySelector("#settings-view .body");
    const children = [...(body?.children ?? [])];
    const selectionAt = children.findIndex((node) => node.querySelector("#selection-toggle"));
    const modeAt = children.findIndex((node) => node.classList.contains("mode-box"));
    const forceAt = children.findIndex((node) => node.contains(toggle));
    const glossaryAt = children.findIndex((node) => node.id === "open-glossary");
    assert.ok(selectionAt >= 0 && selectionAt < modeAt);
    assert.ok(modeAt >= 0 && forceAt === modeAt + 1 && glossaryAt === forceAt + 1);
    assert.match(css, /\.new-tag/);

    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as {
      version: string;
      content_scripts: Array<{ run_at?: string }>;
    };
    assert.equal(manifest.version, "0.1.4");
    assert.equal(manifest.content_scripts[0]?.run_at, "document_start");

    const content = readFileSync(new URL("../content/index.ts", import.meta.url), "utf8");
    const pageview = readFileSync(new URL("../content/pageview.ts", import.meta.url), "utf8");
    assert.match(content, /createForceSelect/);
    assert.match(content, /forceSelectEnabled/);
    assert.match(content, /selectionOffer/);
    assert.match(pageview, /replaceInPlace/);
    assert.match(pageview, /restoreSnapshots/);
    assert.equal(pageview.includes("user-select"), false);
  });
});
