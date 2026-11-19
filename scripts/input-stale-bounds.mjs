import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const dist = path.resolve("dist");
const chrome = process.env.YIFAN_CHROME || "/tmp/cft/chrome-linux64/chrome";
const out = process.env.OUT || "/tmp/yifan-stale-bounds";
await mkdir(out, { recursive: true });
const sample = await readFile(new URL("../dev/sample.html", import.meta.url), "utf8");
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(sample);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const pageUrl = `http://127.0.0.1:${server.address().port}/`;
const log = [];
const note = (message) => {
  log.push(message);
  console.log(message);
};
const fail = (message) => {
  throw new Error(message);
};

const context = await chromium.launchPersistentContext("/tmp/yifan-stale-bounds-profile", {
  executablePath: chrome,
  headless: false,
  viewport: { width: 1100, height: 800 },
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--no-first-run",
    "--no-sandbox",
    "--disable-dev-shm-usage",
  ],
});

const report = [];

try {
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  await sw.evaluate(async () => {
    const enc = new TextEncoder();
    globalThis.__yifanFetches = 0;
    globalThis.__yifanFetchLog = [];
    globalThis.fetch = async (_input, init) => {
      globalThis.__yifanFetches += 1;
      const peeked = init && init.body ? JSON.parse(String(init.body)) : {};
      globalThis.__yifanFetchLog.push(String(peeked.messages?.at(-1)?.content ?? "").slice(0, 80));
      const body = init && init.body ? JSON.parse(String(init.body)) : {};
      const user = String(body.messages?.at(-1)?.content ?? "");
      let content = "YF1 ja\n译文A";
      if (user.includes("TEXT-B")) content = "YF1 fr\n译文B";
      if (user.includes("PLAIN-A")) content = "具体译文A";
      if (user.includes("UNKNOWN")) content = "YF1 unknown\n未知译文";
      if (user.includes("PROTOCOL")) content = "没有协议头的正文";
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, 8) } }] })}\n\n`));
          await new Promise((resolve) => setTimeout(resolve, 600));
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(8) } }] })}\n\n`));
          await new Promise((resolve) => setTimeout(resolve, 200));
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    };
    await chrome.storage.local.set({
      "yifan.settings.v1": {
        provider: "qwen",
        providers: {
          qwen: { apiKey: "sk-mock-not-real", model: "qwen3.7-plus", visionModel: "qwen3-vl-plus" },
          openai: { apiKey: "", model: "gpt-4o-mini", visionModel: "" },
          volcano: { apiKey: "", model: "doubao-seed-1.6", visionModel: "" },
          deepseek: { apiKey: "", model: "deepseek-chat", visionModel: "" },
          kimi: { apiKey: "", model: "moonshot-v1-8k", visionModel: "" },
        },
        apiKey: "sk-mock-not-real",
        model: "qwen3.7-plus",
        sourceLang: "auto",
        targetLang: "zh",
        selectionEnabled: true,
        gestureEnabled: true,
        forceSelectEnabled: false,
      },
    });
  });

  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.waitForTimeout(400);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(pageUrl).origin });
  const float = page.locator("#yifan-input");

  async function openFloat() {
    await sw.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === url);
      if (!tab?.id) throw new Error("找不到示例页");
      await chrome.tabs.sendMessage(tab.id, { type: "open-input-translate" });
    }, pageUrl);
    await float.waitFor();
  }

  async function fetches() {
    return sw.evaluate(() => globalThis.__yifanFetches);
  }

  async function readUi(label) {
    const ui = await page.evaluate(async () => {
      const root = document.getElementById("yifan-input")?.shadowRoot;
      if (!root) return null;
      const body = root.querySelector(".btext")?.textContent ?? "";
      const statusNode = root.querySelector(".input-status");
      const statusText = statusNode && !statusNode.hidden ? statusNode.textContent ?? "" : "";
      const copyButton = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes("复制"));
      const pill = root.querySelector(".input-pill");
      const pillStyle = pill ? getComputedStyle(pill) : null;
      const pillRect = pill ? pill.getBoundingClientRect() : null;
      const pillText = pill && !pill.hidden ? pill.textContent ?? "" : "";
      const value = root.querySelector("textarea")?.value ?? "";
      const swap = root.querySelector(".input-swap");
      let clip = "sentinel";
      try {
        await navigator.clipboard.writeText("sentinel");
      } catch {
        clip = "write-failed";
      }
      if (copyButton) copyButton.click();
      try {
        clip = await navigator.clipboard.readText();
      } catch (error) {
        clip = `read-failed ${error}`;
      }
      return {
        body,
        statusText,
        pillText,
        pillDisplay: pillStyle?.display ?? "",
        pillWidth: pillRect?.width ?? -1,
        pillHeight: pillRect?.height ?? -1,
        value,
        copyVisible: Boolean(copyButton && !copyButton.hidden),
        swapDisabled: Boolean(swap?.disabled),
        clip,
      };
    });
    if (!ui) fail(`${label} 没有输入浮窗`);
    report.push({ label, ...ui, fetches: await fetches() });
    note(`${label} ${JSON.stringify(ui)}`);
    return ui;
  }

  function assertNoOld(label, ui, oldText) {
    if (ui.body.includes(oldText)) fail(`${label} DOM 仍有旧译文 ${oldText}`);
    if (ui.clip.includes(oldText)) fail(`${label} 剪贴板读到旧译文 ${oldText}`);
    if (ui.copyVisible) fail(`${label} 复制按钮仍可用`);
    if (ui.pillText.includes("日语") || ui.pillText.includes("法语")) fail(`${label} 旧识别还在`);
    if (ui.pillDisplay !== "none" || ui.pillWidth !== 0 || ui.pillHeight !== 0) {
      fail(`${label} 空胶囊仍占用画面 display=${ui.pillDisplay} ${ui.pillWidth}x${ui.pillHeight}`);
    }
  }

  await openFloat();
  const empty = await readUi("empty");
  if (empty.pillDisplay !== "none" || empty.pillWidth !== 0) fail("空态仍画出识别胶囊");
  await page.screenshot({ path: path.join(out, "pass-empty.png") });
  const before = await fetches();
  await float.locator("textarea").fill("TEXT-A 原文");
  await float.getByRole("button", { name: "翻译", exact: true }).click();
  await page.waitForTimeout(150);
  const started = await fetches();
  if (started !== before + 1) {
    const calls = await sw.evaluate(() => globalThis.__yifanFetchLog);
    fail(`提交后请求数是 ${started - before}，记录 ${JSON.stringify(calls)}`);
  }
  await float.locator("textarea").fill("TEXT-B 新原文");
  if ((await fetches()) !== started) {
    const calls = await sw.evaluate(() => globalThis.__yifanFetchLog);
    fail(`改字后请求数增加，记录 ${JSON.stringify(calls)}`);
  }
  await page.waitForTimeout(1200);
  const pending = await readUi("pending-edit");
  assertNoOld("pending-edit", pending, "译文A");
  if (!pending.value.includes("TEXT-B")) fail("新原文没有保留");
  if (!pending.statusText.includes("重新翻译")) fail("pending 后没有提示重新翻译");
  await page.screenshot({ path: path.join(out, "pass-pending-edit.png") });

  await float.locator("textarea").pressSequentially("连续", { delay: 20 });
  await page.waitForTimeout(900);
  const rapid = await readUi("rapid-edit");
  assertNoOld("rapid-edit", rapid, "译文A");
  if ((await fetches()) !== before + 1) fail("连续编辑触发了请求");

  await float.locator("textarea").fill("TEXT-A 原文");
  await page.waitForTimeout(900);
  const restored = await readUi("restore-A");
  assertNoOld("restore-A", restored, "译文A");
  if (restored.pillText) fail("把原文改回 A 后识别被恢复");
  if ((await fetches()) !== before + 1) fail("改回 A 触发了请求");

  await float.getByRole("button", { name: "翻译", exact: true }).click();
  await page.waitForTimeout(1200);
  const again = await readUi("resubmit-A");
  if (!again.body.includes("译文A") || !again.copyVisible) fail("重新提交 A 后没有新译文");
  await float.locator("textarea").fill("TEXT-B 改后");
  await page.waitForTimeout(200);
  const edited = await readUi("after-complete-edit");
  assertNoOld("after-complete-edit", edited, "译文A");
  if (!edited.value.includes("TEXT-B")) fail("完成后的新原文没有保留");
  if (!edited.statusText.includes("重新翻译")) fail("完成后改字没有提示重新翻译");
  await page.screenshot({ path: path.join(out, "pass-after-edit.png") });

  await page.evaluate(() => {
    const area = document.getElementById("yifan-input")?.shadowRoot?.querySelector("textarea");
    if (!area) throw new Error("没有文本框");
    area.focus();
    area.dispatchEvent(new CompositionEvent("compositionstart"));
    area.value = "TEXT-B 改后组";
    area.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "组" }));
    area.dispatchEvent(new CompositionEvent("compositionend", { data: "组" }));
  });
  await page.waitForTimeout(200);
  const ime = await readUi("ime");
  assertNoOld("ime", ime, "译文A");

  await float.locator("textarea").fill("");
  const cleared = await readUi("clear");
  assertNoOld("clear", cleared, "译文A");
  if (cleared.value !== "") fail("清空后原文还在");

  await float.locator("#yifan-input-source").selectOption("en");
  await page.waitForTimeout(200);
  await float.locator("textarea").fill("PLAIN-A 具体源");
  await float.getByRole("button", { name: "翻译", exact: true }).click();
  await page.waitForTimeout(1200);
  const concreteDone = await readUi("concrete-done");
  if (!concreteDone.body.includes("具体译文A")) fail("具体源语言没有显示当次译文");
  await float.locator("textarea").fill("PLAIN-A 已改");
  await page.waitForTimeout(200);
  const concrete = await readUi("concrete-edit");
  assertNoOld("concrete-edit", concrete, "具体译文A");
  if (!concrete.value.includes("已改")) fail("具体源语言改字后原文丢失");
  await page.screenshot({ path: path.join(out, "pass-concrete.png") });

  await float.locator("#yifan-input-source").selectOption("auto");
  await page.waitForTimeout(200);
  await float.locator("textarea").fill("UNKNOWN 文本");
  await float.getByRole("button", { name: "翻译", exact: true }).click();
  await page.waitForTimeout(1200);
  const unknownDone = await readUi("unknown-done");
  if (!unknownDone.body.includes("未知译文")) fail("unknown 没有显示正文");
  if (!unknownDone.statusText.includes("手动选择") && !unknownDone.pillText) {
    const hint = await page.evaluate(() => {
      const node = document.getElementById("yifan-input")?.shadowRoot?.querySelector(".input-hint");
      return node && !node.hidden ? node.textContent ?? "" : "";
    });
    if (!hint.includes("手动选择") && !unknownDone.statusText.includes("未识别")) fail(`unknown 没有手选提示: ${unknownDone.statusText} / ${hint}`);
  }
  if (unknownDone.swapDisabled !== true) fail("unknown 完成时 auto 互换没有禁用");
  if (unknownDone.pillDisplay !== "none" || unknownDone.pillWidth !== 0) fail("unknown 仍画出空胶囊");
  await page.screenshot({ path: path.join(out, "unknown-complete.png") });
  await float.locator("textarea").fill("UNKNOWN 已改");
  await page.waitForTimeout(200);
  const unknown = await readUi("unknown-edit");
  assertNoOld("unknown-edit", unknown, "未知译文");
  await page.screenshot({ path: path.join(out, "unknown-after-edit.png") });

  await float.locator("textarea").fill("PROTOCOL 文本");
  await float.getByRole("button", { name: "翻译", exact: true }).click();
  await page.waitForTimeout(1200);
  const protocolDone = await readUi("protocol-done");
  if (protocolDone.body.includes("没有协议头")) fail("协议错误把正文写出来了");
  if (!protocolDone.statusText.includes("协议错误")) fail("没有协议错误提示");
  if (protocolDone.copyVisible) fail("协议错误仍可复制");
  if (!protocolDone.value.includes("PROTOCOL 文本")) fail("协议错误没有保留原文");
  if (protocolDone.pillDisplay !== "none" || protocolDone.pillWidth !== 0) fail("协议错误仍画出空胶囊");
  if (protocolDone.swapDisabled !== true) fail("协议错误时 auto 互换没有禁用");
  await page.screenshot({ path: path.join(out, "protocol-error.png") });
  await float.locator("textarea").fill("PROTOCOL 已改");
  await page.waitForTimeout(300);
  const protocol = await readUi("protocol-edit");
  assertNoOld("protocol-edit", protocol, "没有协议头");
  if (!protocol.value.includes("PROTOCOL 已改")) fail("协议错误后原文丢失");
  await page.screenshot({ path: path.join(out, "protocol-after-edit.png") });

  const fetchesBeforeB = await fetches();
  await float.locator("textarea").fill("TEXT-B 新提交");
  await float.getByRole("button", { name: "翻译", exact: true }).click();
  await page.waitForTimeout(1200);
  const submittedB = await readUi("submit-B");
  if (!submittedB.body.includes("译文B")) fail("新提交没有显示 B 的译文");
  if (submittedB.body.includes("译文A") || submittedB.clip.includes("译文A")) fail("新提交仍能读到旧译文");
  if ((await fetches()) !== fetchesBeforeB + 1) fail("新提交没有发出自己的请求");

  const fetchesBeforeDirection = await fetches();
  await float.locator("#yifan-input-target").selectOption("en");
  await page.waitForTimeout(300);
  const direction = await readUi("direction");
  assertNoOld("direction", direction, "译文B");
  if (!direction.statusText.includes("重新翻译")) fail("改方向后没有提示重新翻译");
  if ((await fetches()) !== fetchesBeforeDirection) fail("改方向触发了请求");
  if (!direction.value.includes("TEXT-B")) fail("改方向丢掉了原文");

  await float.locator("#yifan-input-target").selectOption("zh");
  await page.waitForTimeout(200);
  await float.locator("textarea").fill("TEXT-B 粘贴前");
  await float.getByRole("button", { name: "翻译", exact: true }).click();
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const area = document.getElementById("yifan-input")?.shadowRoot?.querySelector("textarea");
    if (!area) throw new Error("没有文本框");
    area.focus();
    area.value = "TEXT-B 粘贴后";
    area.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: "粘贴后" }));
  });
  await page.waitForTimeout(900);
  const pasted = await readUi("paste");
  assertNoOld("paste", pasted, "译文B");
  if (!pasted.value.includes("粘贴后")) fail("粘贴没有留下新原文");

  await float.getByRole("button", { name: "关闭输入翻译" }).click();
  await page.waitForTimeout(200);
  const fetchesBeforeReopen = await fetches();
  await openFloat();
  await float.locator("textarea").fill("TEXT-A 原文");
  await page.waitForTimeout(300);
  const reopened = await readUi("reopen");
  assertNoOld("reopen", reopened, "译文A");
  if (reopened.pillText) fail("关窗重开后恢复了识别");
  if ((await fetches()) !== fetchesBeforeReopen) fail("重开或填回旧原文触发了请求");
  await page.screenshot({ path: path.join(out, "pass-reopen.png") });

  async function setExact(value) {
    await page.evaluate((next) => {
      const area = document.getElementById("yifan-input")?.shadowRoot?.querySelector("textarea");
      if (!area) throw new Error("没有文本框");
      area.focus();
      area.value = next;
      area.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }, value);
  }

  const beforeHello = await fetches();
  await setExact("hello\n");
  await float.getByRole("button", { name: "翻译", exact: true }).click();
  await page.waitForTimeout(1200);
  const helloDone = await readUi("hello-newline-done");
  if (!helloDone.body.includes("译文A") || !helloDone.copyVisible) fail("带换行提交后没有可复制的译文");
  if (!helloDone.pillText.includes("日语") || helloDone.swapDisabled) fail("当前修订没有用提交正文显示识别和互换");
  if (helloDone.pillDisplay === "none" || helloDone.pillWidth < 8) fail("成功识别的胶囊没有画出来");
  if ((await fetches()) !== beforeHello + 1) fail("带换行提交的请求数不对");
  await page.screenshot({ path: path.join(out, "pass-hello-newline.png") });

  await setExact("hello");
  await page.waitForTimeout(250);
  const helloTrimmed = await readUi("hello-delete-newline");
  assertNoOld("hello-delete-newline", helloTrimmed, "译文A");
  if (!helloTrimmed.swapDisabled) fail("删掉末尾换行后互换被恢复");
  if ((await fetches()) !== beforeHello + 1) fail("删换行触发了请求");
  await page.screenshot({ path: path.join(out, "pass-hello-trimmed.png") });

  await setExact("hello\n");
  await page.waitForTimeout(250);
  const helloRestored = await readUi("hello-restore-newline");
  assertNoOld("hello-restore-newline", helloRestored, "译文A");
  if (!helloRestored.swapDisabled) fail("改回带换行的原文后互换被恢复");
  if ((await fetches()) !== beforeHello + 1) fail("改回原文触发了请求");

  const beforeSpace = await fetches();
  await setExact("  hello  ");
  await float.getByRole("button", { name: "翻译", exact: true }).click();
  await page.waitForTimeout(1200);
  const spaced = await readUi("hello-spaces-done");
  if (!spaced.pillText.includes("日语") || spaced.swapDisabled) fail("首尾空格的当前修订没有识别");
  await setExact("hello");
  await page.waitForTimeout(250);
  const spacesGone = await readUi("hello-spaces-deleted");
  assertNoOld("hello-spaces-deleted", spacesGone, "译文A");
  if (!spacesGone.swapDisabled) fail("删掉首尾空格后互换被恢复");
  if ((await fetches()) !== beforeSpace + 1) fail("删空格触发了请求");

  const beforePending = await fetches();
  await setExact("\nhello\n");
  await float.getByRole("button", { name: "翻译", exact: true }).click();
  await page.waitForTimeout(80);
  await setExact("hello");
  if ((await fetches()) !== beforePending + 1) fail("pending 时删换行触发了新请求");
  await page.waitForTimeout(1200);
  const pendingTrim = await readUi("hello-pending-trim");
  assertNoOld("hello-pending-trim", pendingTrim, "译文A");
  if (!pendingTrim.swapDisabled) fail("pending 的 trim 等价编辑恢复了互换");
  if ((await fetches()) !== beforePending + 1) fail("迟到响应补发了请求");
  await page.screenshot({ path: path.join(out, "pass-pending-trim.png") });

  await writeFile(path.join(out, "stale-bounds.json"), JSON.stringify(report, null, 2));
  note("stale bounds ok");
} catch (error) {
  note(`FAILED ${error.stack || error}`);
  await writeFile(path.join(out, "stale-error.txt"), String(error.stack || error));
  process.exitCode = 1;
} finally {
  await writeFile(path.join(out, "stale-log.txt"), `${log.join("\n")}\n`);
  await context.close().catch(() => undefined);
  server.close();
}
