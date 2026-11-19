import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const dist = path.resolve("dist");
const chrome = process.env.YIFAN_CHROME || "/tmp/cft/chrome-linux64/chrome";
const out = process.env.OUT || "/tmp/yifan-input-bounds";
const profile = "/tmp/yifan-input-bounds-profile-zoom1";
await mkdir(out, { recursive: true });

const sample = await readFile(new URL("../dev/sample.html", import.meta.url), "utf8");
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(sample);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const pageUrl = `http://127.0.0.1:${server.address().port}/`;

const log = [];
function note(message) {
  log.push(message);
  console.log(message);
}
note(`sample ${pageUrl}`);

const context = await chromium.launchPersistentContext(profile, {
  executablePath: chrome,
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--no-first-run",
    "--disable-default-apps",
    "--no-sandbox",
    "--disable-dev-shm-usage",
  ],
});

const report = { checks: [] };

function fail(message) {
  throw new Error(message);
}

function inside(name, rect, viewport, margin = 0) {
  const slop = 1;
  const problems = [];
  if (rect.width < 8 || rect.height < 8) problems.push(`尺寸 ${rect.width}x${rect.height}`);
  if (rect.left < margin - slop) problems.push(`left ${rect.left}`);
  if (rect.top < margin - slop) problems.push(`top ${rect.top}`);
  if (rect.right > viewport.width - margin + slop) problems.push(`right ${rect.right} > ${viewport.width - margin}`);
  if (rect.bottom > viewport.height - margin + slop) problems.push(`bottom ${rect.bottom} > ${viewport.height - margin}`);
  if (problems.length) fail(`${name} 不在可视区域内: ${problems.join("; ")}`);
}

const contextClosed = { done: false };

try {
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(sw.url()).host;
  note(`extension ${extensionId}`);
  await sw.evaluate(async () => {
    globalThis.fetch = async (_input, init) => {
      const body = init && init.body ? JSON.parse(String(init.body)) : {};
      const user = body.messages?.at(-1)?.content ?? "";
      let content = "YF1 ja\n模拟译文，未调用真实接口。";
      if (String(user).includes("PROTOCOL")) content = "没有协议头的正文";
      if (String(user).includes("UNKNOWN")) content = "YF1 unknown\n未识别出的模拟译文。";
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    };
    await chrome.storage.local.set({
      "yifan.settings.v1": {
        apiKey: "sk-mock-not-real",
        model: "qwen3.7-plus",
        sourceLang: "zh",
        targetLang: "en",
        selectionEnabled: true,
        forceSelectEnabled: false,
        gestureEnabled: true,
      },
    });
  });

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 1280, height: 800 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator("#hk-swap").waitFor();
  await popup.locator("#shortcut-block").scrollIntoViewIfNeeded();
  await popup.locator("#shortcut-block").screenshot({ path: path.join(out, "settings-shortcuts.png") });
  const shortcutCopy = await popup.locator(".hk-sub").allInnerTexts();
  const swapText = await popup.locator("#hk-swap").innerText();
  const inputText = await popup.locator("#hk-input").innerText();
  if (swapText !== "未绑定" || inputText !== "未绑定") fail(`新两项默认不是未绑定: ${swapText} / ${inputText}`);
  if (!shortcutCopy.every((line) => line.includes("尚未绑定"))) fail(`设置页默认说明不对: ${shortcutCopy.join(" | ")}`);
  if (shortcutCopy.some((line) => line.includes("Alt+Shift"))) fail("设置页默认写出了候选键");
  await popup.getByRole("button", { name: "返回主弹窗" }).click();
  await popup.locator("#home-swap").waitFor();
  const homeNote = await popup.locator("#hotkey-note").innerText();
  if (!homeNote.includes("互换未绑定") || !homeNote.includes("输入翻译未绑定") || !homeNote.includes("请用按钮")) {
    fail(`主弹窗默认快捷说明不对: ${homeNote}`);
  }
  if (homeNote.includes("Alt+Shift+Y") || homeNote.includes("Alt+Shift+I")) fail(`主弹窗默认写出了候选键: ${homeNote}`);
  const homePill = await popup.locator("#home-detect").evaluate((node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return { display: style.display, width: rect.width, height: rect.height, text: node.textContent ?? "" };
  });
  if (homePill.display !== "none" || homePill.width !== 0 || homePill.height !== 0 || homePill.text.trim()) {
    fail(`主弹窗空识别胶囊仍占位: ${JSON.stringify(homePill)}`);
  }
  note(`home-detect ${JSON.stringify(homePill)}`);
  await popup.screenshot({ path: path.join(out, "popup-desktop.png") });
  await popup.setViewportSize({ width: 360, height: 780 });
  await popup.screenshot({ path: path.join(out, "popup-360.png") });
  await popup.setViewportSize({ width: 390, height: 844 });
  await popup.screenshot({ path: path.join(out, "popup-390.png") });
  await popup.setViewportSize({ width: 1600, height: 1400 });
  const popupZoom = await zoomTo(popup, sw, 2);
  note(`popup 200% ${JSON.stringify(popupZoom)}`);
  if (!popupZoom.ok) fail(`主弹窗 200% 缩放失败: ${popupZoom.message || ""}`);
  await popup.screenshot({ path: path.join(out, "popup-200.png") });
  note(`popup zoom2 on 1600 ${JSON.stringify(await readZoom(popup, sw))}`);
  await zoomTo(popup, sw, 1);
  await popup.setViewportSize({ width: 360, height: 640 });
  const popupZoom360 = await zoomTo(popup, sw, 2);
  const popupMetrics360 = await readZoom(popup, sw);
  note(`popup zoom2 on 360x640 ${JSON.stringify({ popupZoom360, popupMetrics360 })}`);
  await popup.screenshot({ path: path.join(out, "popup-zoom2-on-360.png") });
  await zoomTo(popup, sw, 1);

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(pageUrl);
  await page.waitForTimeout(400);
  await page.keyboard.press("Alt+Shift+I");
  await page.keyboard.press("Alt+Shift+Y");
  await page.waitForTimeout(300);
  if (await page.locator("#yifan-input").count()) fail("未绑定的 Alt+Shift+I/Y 打开了输入浮窗");
  note("fresh Y/I did not open input");
  const opened = await sw.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === url);
    if (!tab?.id) return { ok: false, message: "找不到示例页" };
    await chrome.tabs.sendMessage(tab.id, { type: "open-input-translate" });
    return { ok: true };
  }, pageUrl);
  if (!opened.ok) fail(opened.message || "打不开输入浮窗");
  const float = page.locator("#yifan-input");
  await float.waitFor();

  async function measure(label) {
    const data = await page.evaluate(() => {
      const host = document.getElementById("yifan-input");
      const root = host?.shadowRoot;
      if (!host || !root) return null;
      const pick = (selector) => {
        const node = root.querySelector(selector);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      const area = root.querySelector("textarea");
      const style = area ? getComputedStyle(area) : null;
      const hostRect = host.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        visual: {
          width: window.visualViewport?.width ?? window.innerWidth,
          height: window.visualViewport?.height ?? window.innerHeight,
        },
        host: { left: hostRect.left, top: hostRect.top, right: hostRect.right, bottom: hostRect.bottom, width: hostRect.width, height: hostRect.height },
        close: pick(".input-close"),
        zoom: pick(".zoom-btn"),
        swap: pick(".input-swap"),
        translate: pick(".btn.primary"),
        textarea: pick("textarea"),
        resize: style?.resize ?? "",
        overflow: style?.overflowY ?? "",
        scrollable: area ? area.scrollHeight > area.clientHeight : false,
      };
    });
    if (!data) fail(`${label} 没有输入浮窗`);
    const viewport = data.visual.width ? data.visual : data.viewport;
    inside(`${label} 浮窗`, data.host, viewport, 7);
    for (const key of ["close", "zoom", "swap", "translate", "textarea"]) {
      if (!data[key]) fail(`${label} 缺少 ${key}`);
      inside(`${label} ${key}`, data[key], viewport, 0);
    }
    if (data.resize !== "none") fail(`${label} 文本框仍可缩放: ${data.resize}`);
    report.checks.push({ label, ...data });
    note(`${label} host ${Math.round(data.host.left)},${Math.round(data.host.top)} ${Math.round(data.host.width)}x${Math.round(data.host.height)} in ${Math.round(viewport.width)}x${Math.round(viewport.height)} resize=${data.resize}`);
    return data;
  }

  await page.screenshot({ path: path.join(out, "input-desktop.png") });
  await measure("desktop");

  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, "input-360.png") });
  await measure("360");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(200);
  const head = float.locator(".input-hd");
  const headBox = await head.boundingBox();
  if (!headBox) fail("拖动标题栏没有盒子");
  await page.mouse.move(headBox.x + 30, headBox.y + 12);
  await page.mouse.down();
  await page.mouse.move(1800, 1400, { steps: 8 });
  await page.mouse.up();
  const dragged = await measure("desktop-dragged");
  if (dragged.host.right < dragged.visual.width - 20) fail("拖动没有贴住右缘，断言没有覆盖失联");
  await page.screenshot({ path: path.join(out, "input-desktop-dragged.png") });

  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, "input-360-after-drag.png") });
  await measure("360-after-drag");

  await float.getByRole("button", { name: "放大" }).click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(out, "input-360-enlarged.png") });
  await measure("360-enlarged");
  await float.getByRole("button", { name: "还原" }).click();
  await page.waitForTimeout(100);
  await measure("360-restored");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, "input-390.png") });
  await measure("390");

  await page.setViewportSize({ width: 1600, height: 1400 });
  const pageZoom = await zoomTo(page, sw, 2);
  note(`input 200% ${JSON.stringify(pageZoom)}`);
  if (!pageZoom.ok) fail(`输入浮窗 200% 缩放失败: ${pageZoom.message || ""}`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, "input-200.png") });
  await measure("200%");
  await zoomTo(page, sw, 1);

  await page.setViewportSize({ width: 720, height: 900 });
  const narrowZoom = await zoomTo(page, sw, 2);
  note(`input 200% narrow ${JSON.stringify(narrowZoom)}`);
  if (!narrowZoom.ok) fail(`窄视口 200% 缩放失败`);
  await page.waitForTimeout(250);
  const zoom720 = await readZoom(page, sw);
  note(`zoom2 on 720 window ${JSON.stringify(zoom720)}`);
  await measure("zoom2-on-720");
  await page.screenshot({ path: path.join(out, "input-zoom2-on-720.png") });
  await zoomTo(page, sw, 1);
  await page.setViewportSize({ width: 360, height: 640 });
  const zoom360 = await zoomTo(page, sw, 2);
  const metrics360 = await readZoom(page, sw);
  note(`zoom2 on 360x640 ${JSON.stringify({ zoom360, metrics360 })}`);
  await page.screenshot({ path: path.join(out, "input-zoom2-on-360.png") });
  await measure("zoom2-on-360");
  await zoomTo(page, sw, 1);
  await page.setViewportSize({ width: 1280, height: 800 });

  await float.locator("textarea").fill("这是一段用来确认窗内滚动的长文字。".repeat(40));
  const scrolled = await measure("long-text");
  if (!scrolled.scrollable) fail("长文没有在文本框内滚动");

  await sw.evaluate(async () => {
    const bag = await chrome.storage.local.get("yifan.settings.v1");
    const current = bag["yifan.settings.v1"] ?? {};
    current.sourceLang = "auto";
    current.targetLang = "zh";
    await chrome.storage.local.set({ "yifan.settings.v1": current });
  });
  await page.waitForTimeout(300);

  async function submit(text, file) {
    const area = float.locator("textarea");
    await area.fill(text);
    await float.getByRole("button", { name: "翻译", exact: true }).click();
    await page.waitForFunction(() => {
      const root = document.getElementById("yifan-input")?.shadowRoot;
      const status = root?.querySelector(".input-status");
      const body = root?.querySelector(".btext");
      const statusText = status && !status.hidden ? status.textContent ?? "" : "";
      if (statusText.includes("正在翻译")) return false;
      return Boolean(statusText || body?.textContent?.trim());
    });
    await page.screenshot({ path: path.join(out, file) });
    await measure(file);
  }

  await submit("UNKNOWN 这段需要未知语言头", "input-unknown.png");
  await submit("PROTOCOL 这段没有协议头", "input-protocol-error.png");
  const kept = await float.locator("textarea").inputValue();
  if (!kept.includes("PROTOCOL")) fail("协议错误没有留下原文");
  const copyVisible = await float.getByRole("button", { name: "复制译文" }).isVisible().catch(() => false);
  if (copyVisible) fail("协议错误仍显示复制按钮");
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, "input-protocol-360.png") });
  await measure("protocol-360");
  await writeFile(path.join(out, "bounds.json"), JSON.stringify(report, null, 2));
  note("bounds ok");
} catch (error) {
  note(`FAILED ${error.stack || error}`);
  await writeFile(path.join(out, "bounds-error.txt"), String(error.stack || error));
  process.exitCode = 1;
} finally {
  await writeFile(path.join(out, "bounds-log.txt"), `${log.join("\n")}\n`);
  if (!contextClosed.done) await context.close().catch(() => undefined);
  server.close();
}

async function readZoom(page, sw) {
  const box = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    devicePixelRatio: window.devicePixelRatio,
    visual: {
      width: window.visualViewport?.width ?? null,
      height: window.visualViewport?.height ?? null,
      scale: window.visualViewport?.scale ?? null,
      offsetLeft: window.visualViewport?.offsetLeft ?? null,
      offsetTop: window.visualViewport?.offsetTop ?? null,
    },
  }));
  const zoom = await sw.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === url);
    if (!tab?.id) return null;
    return chrome.tabs.getZoom(tab.id);
  }, page.url());
  return { ...box, chromeZoom: zoom };
}

async function zoomTo(page, sw, factor) {
  await page.bringToFront();
  const url = page.url();
  const api = await sw.evaluate(async ({ factor, url }) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === url);
    if (!tab?.id) return { ok: false, message: "找不到标签" };
    try {
      await chrome.tabs.setZoom(tab.id, factor);
      return { ok: true, zoom: await chrome.tabs.getZoom(tab.id) };
    } catch (error) {
      return { ok: false, message: String(error) };
    }
  }, { factor, url });
  await page.waitForTimeout(200);
  const ratio = await page.evaluate(() => window.devicePixelRatio);
  return { ...api, devicePixelRatio: ratio };
}
