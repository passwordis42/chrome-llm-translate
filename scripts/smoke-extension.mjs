import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const dist = path.resolve("dist");
const profile = "/tmp/yifan-chrome-profile";
const chromeForTesting = process.env.YIFAN_CHROME || "/tmp/cft/chrome-linux64/chrome";
const shots = "/tmp/yifan-shots";
await mkdir(shots, { recursive: true });

const sample = await readFile(new URL("../dev/sample.html", import.meta.url), "utf8");
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(sample);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const pageUrl = `http://127.0.0.1:${port}/`;

const context = await chromium.launchPersistentContext(profile, {
  executablePath: chromeForTesting,
  headless: false,
  viewport: { width: 1100, height: 820 },
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--no-first-run",
    "--disable-default-apps",
    "--disable-sync",
    "--no-sandbox",
    "--disable-dev-shm-usage",
  ],
});

const fail = (message) => {
  throw new Error(message);
};

try {
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(sw.url()).host;
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.shadowPlain = (hostId) => {
      const root = document.getElementById(hostId)?.shadowRoot;
      if (!root) return "";
      return [...root.children]
        .filter((node) => node.tagName !== "STYLE")
        .map((node) => node.textContent ?? "")
        .join("\n");
    };
  });
  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  const early = await page.evaluate(() => ({
    float: Boolean(document.getElementById("yifan-float")),
    confirmBar: Boolean(document.getElementById("yifan-select-confirm")),
    dialog: Boolean(document.getElementById("yifan-dialog")),
    bilingual:
      Boolean(document.getElementById("yifan-page")) ||
      Boolean(document.querySelector("[data-yifan-inline]")) ||
      Boolean(document.querySelector("[data-yifan-replaced]")),
    sample: document.querySelector("#sample")?.textContent ?? "",
  }));
  if (early.float || early.confirmBar || early.dialog || early.bilingual) fail(`进页就改了 DOM: ${JSON.stringify(early)}`);
  if (!early.sample.includes("floating card")) fail("示例页原文丢失");

  await selectSample(page, "#sample");
  await page.locator("#yifan-select-confirm").waitFor({ timeout: 5000 });
  if (await page.locator("#yifan-float").count()) fail("未点翻译就打开了浮层");
  const confirmText = await shadowText(page, "yifan-select-confirm");
  if (!confirmText.includes("一翻 · 确认翻译")) fail(`确认条文案不对: ${confirmText}`);
  if (!confirmText.includes("When a sentence matters")) fail(`确认条没有原文: ${confirmText}`);
  await page.locator("#yifan-select-confirm").screenshot({ path: path.join(shots, "select-confirm.png") });
  await page.locator("#yifan-select-confirm").getByRole("button", { name: "取消" }).click();
  await page.locator("#yifan-select-confirm").waitFor({ state: "detached", timeout: 3000 });
  if (await page.locator("#yifan-float").count()) fail("取消确认后仍然打开了浮层");

  await selectSample(page, "#sample");
  await page.locator("#yifan-select-confirm").waitFor({ timeout: 5000 });
  await page.locator("#yifan-select-confirm").getByRole("button", { name: "翻译", exact: true }).click();
  await page.locator("#yifan-float").waitFor({ timeout: 5000 });
  if (await page.locator("#yifan-select-confirm").count()) fail("点翻译后确认条还在");
  await page.waitForFunction((id) => window.shadowPlain(id).includes("不会假翻"), "yifan-float");
  const floatText = await shadowText(page, "yifan-float");
  if (!floatText.includes("不会假翻")) fail(`划词失败提示不对: ${floatText}`);
  if (!floatText.includes("When a sentence matters")) fail(`浮层没有原文: ${floatText}`);
  if (floatText.includes("插件会把")) fail("没有 Key 却出现了假译文");
  await page.locator("#yifan-float").screenshot({ path: path.join(shots, "float-error.png") });
  await page.locator("#yifan-float").getByRole("button", { name: "关闭" }).click();
  await page.locator("#yifan-float").waitFor({ state: "detached", timeout: 3000 });

  await sw.evaluate(async () => {
    const bag = await chrome.storage.local.get("yifan.settings.v1");
    const current = bag["yifan.settings.v1"] ?? {
      apiKey: "",
      model: "qwen3.7-plus",
      sourceLang: "auto",
      targetLang: "zh",
      selectionEnabled: true,
      glossary: [],
    };
    current.selectionMode = "immediate";
    current.selectionEnabled = true;
    await chrome.storage.local.set({ "yifan.settings.v1": current });
  });
  await page.waitForTimeout(200);
  await selectSample(page, "#second");
  await page.locator("#yifan-float").waitFor({ timeout: 5000 });
  if (await page.locator("#yifan-select-confirm").count()) fail("划完即翻仍然先出确认条");
  const immediateText = await shadowText(page, "yifan-float");
  if (!immediateText.includes("Unimportant pages")) fail(`划完即翻没有带上选区: ${immediateText}`);
  if (!immediateText.includes("不会假翻")) fail("划完即翻不该假翻");
  await page.locator("#yifan-float").getByRole("button", { name: "关闭" }).click();
  await page.locator("#yifan-float").waitFor({ state: "detached", timeout: 3000 });

  await sw.evaluate(async () => {
    await chrome.storage.local.set({
      "yifan.settings.v1": {
        apiKey: "",
        model: "qwen-plus",
        sourceLang: "auto",
        targetLang: "zh",
        selectionEnabled: false,
        glossary: [],
      },
    });
  });
  await page.waitForTimeout(200);
  await selectSample(page, "#second");
  await page.waitForTimeout(400);
  if (await page.locator("#yifan-float").count()) fail("关掉划词之后仍然弹出");
  if (await page.locator("#yifan-select-confirm").count()) fail("关掉划词之后仍然出确认条");

  const tabId = await tabIdFor(sw, pageUrl);
  await page.evaluate(() => getSelection()?.removeAllRanges());
  const explicit = sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "translate-selection", text: "Hello explicit" }), tabId);
  await page.locator("#yifan-float").waitFor({ timeout: 5000 });
  const explicitText = await shadowText(page, "yifan-float");
  if (!explicitText.includes("Hello explicit")) fail(`右键划词没带上选区: ${explicitText}`);
  if (!explicitText.includes("不会假翻")) fail("右键划词不该假翻");
  await page.locator("#yifan-float").getByRole("button", { name: "关闭" }).click();
  await explicit;

  await sw.evaluate(async () => {
    const bag = await chrome.storage.local.get("yifan.settings.v1");
    const current = bag["yifan.settings.v1"];
    current.selectionEnabled = true;
    await chrome.storage.local.set({ "yifan.settings.v1": current });
  });

  const aiCancel = sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "show-page-ai" }), tabId);
  await page.locator("#yifan-dialog").waitFor({ timeout: 5000 });
  const aiCopy = await shadowText(page, "yifan-dialog");
  if (!aiCopy.includes("原位替换为译文") || !aiCopy.includes("可见区直接换成译文")) {
    fail(`整页 AI 确认文案不对: ${aiCopy}`);
  }
  if (aiCopy.includes("段落下方") || aiCopy.includes("退出对照")) fail(`确认框还是旧文案: ${aiCopy}`);
  await page.locator("#yifan-dialog").screenshot({ path: path.join(shots, "confirm-ai.png") });
  await page.locator("#yifan-dialog").getByRole("button", { name: "取消" }).click();
  await aiCancel;
  await page.waitForTimeout(200);
  if (await page.locator("#yifan-page").count()) fail("取消整页 AI 之后仍然出现盖层");
  if (await page.locator("[data-yifan-inline]").count()) fail("取消整页 AI 之后仍然插入了译文");
  if (await page.locator("[data-yifan-replaced]").count()) fail("取消整页 AI 之后替换了原文");
  if (page.url() !== pageUrl) fail(`取消后 URL 变了: ${page.url()}`);

  const aiRun = sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "show-page-ai" }), tabId);
  await page.locator("#yifan-dialog").getByRole("button", { name: "确认翻译" }).click();
  await page.locator("#yifan-inline-bar").waitFor({ timeout: 5000 });
  await page.waitForFunction((id) => window.shadowPlain(id).includes("不会假翻"), "yifan-inline-bar");
  const barText = await shadowText(page, "yifan-inline-bar");
  if (!barText.includes("译文直接替换原文；下滑自动续翻；清除可还原")) fail(`工具条说明不对: ${barText}`);
  if (!barText.includes("继续下滑将自动续翻未译段落（每批最多 200 段）")) fail(`工具条没有续翻说明: ${barText}`);
  if (!barText.includes("复制全部译文") || !barText.includes("清除译文")) fail(`工具条按钮不对: ${barText}`);
  if (barText.includes("退出对照") || barText.includes("段落下")) fail(`工具条还是旧文案: ${barText}`);
  if (!barText.includes("不会假翻")) fail("没 Key 时工具条应写明失败");
  if (await page.locator("[data-yifan-inline]").count()) fail("整页 AI 仍在段落下插译文");
  if (await page.locator("[data-yifan-replaced]").count()) fail("没 Key 时不应原位替换");
  const sampleText = await page.locator("#sample").textContent();
  if (!sampleText?.includes("When a sentence matters")) fail("没 Key 时原文被替换了");
  if (sampleText?.includes("不会假翻")) fail("失败提示写进了原文");
  const originalStillThere = await page.locator("article h1").textContent();
  if (!originalStillThere?.includes("Large language models")) fail("原文标题被替换了");
  if (await page.locator("#yifan-page").count()) fail("整页 AI 不该打开全屏盖层");
  const locked = await page.evaluate(() => document.documentElement.style.overflow);
  if (locked === "hidden") fail("整页 AI 锁了页面滚动");
  await page.locator("#stay-link").click();
  if (!page.url().includes("#still-here")) fail("整页 AI 之后原页链接点不了");
  await page.screenshot({ path: path.join(shots, "inline.png") });
  await page.locator("#yifan-inline-bar").getByRole("button", { name: "清除译文" }).click();
  await page.locator("#yifan-inline-bar").waitFor({ state: "detached", timeout: 3000 });
  if (await page.locator("[data-yifan-inline]").count() || await page.locator("[data-yifan-replaced]").count()) {
    fail("清除后页面上还有译文标记");
  }
  await aiRun;
  if (!(await page.locator("article h1").textContent())?.includes("Large language models")) {
    fail("清除译文后原文没了");
  }
  await page.locator("#stay-link").click();
  if (!page.url().includes("#still-here")) fail("清除后原页链接点不了");

  const googleCancel = sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "show-page-google" }), tabId);
  await page.locator("#yifan-dialog").waitFor();
  const googleCopy = await shadowText(page, "yifan-dialog");
  if (!googleCopy.includes("用浏览器自带") || !googleCopy.includes("唤起页面翻译") || !googleCopy.includes("不跳转")) {
    fail(`谷歌确认文案不对: ${googleCopy}`);
  }
  await page.locator("#yifan-dialog").screenshot({ path: path.join(shots, "confirm-google.png") });
  await page.locator("#yifan-dialog").getByRole("button", { name: "取消" }).click();
  await googleCancel;
  if (page.url().includes("translate.google.com")) fail("取消谷歌后跳到了 translate.google.com");
  if (!page.url().startsWith(pageUrl.replace(/#.*$/, ""))) fail("取消谷歌后页面被导航走了");
  if (
    await page.locator("#yifan-page").count() ||
    await page.locator("[data-yifan-inline]").count() ||
    await page.locator("[data-yifan-replaced]").count()
  ) {
    fail("谷歌确认不该插入或替换 LLM 译文");
  }

  const beforeGoogle = page.url();
  const googleRun = sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "show-page-google" }), tabId);
  await page.locator("#yifan-dialog").waitFor();
  await page.locator("#yifan-dialog").getByRole("button", { name: "唤起页面翻译" }).click();
  const closeNotice = page.locator("#yifan-dialog").getByRole("button", { name: "关闭" });
  await Promise.race([
    closeNotice.waitFor({ timeout: 8000 }),
    googleRun,
  ]);
  if (page.url().includes("translate.google.com")) fail("整页谷歌跳到了 translate.google.com");
  if (new URL(page.url()).origin !== new URL(beforeGoogle).origin) fail(`整页谷歌把页面导航走了: ${page.url()}`);
  if (await closeNotice.count()) {
    const notice = await shadowText(page, "yifan-dialog");
    if (!notice.includes("没有跳转") && !notice.includes("没有调起来")) {
      fail(`谷歌失败提示不清楚: ${notice}`);
    }
    await closeNotice.click();
  }
  await googleRun;

  await sw.evaluate(async () => chrome.storage.local.remove("yifan.settings.v1"));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole("heading", { name: "一翻" }).waitFor();
  const defaultModel = await popup.locator("#model").inputValue();
  if (defaultModel !== "qwen3.7-plus") fail(`默认模型不是 qwen3.7-plus: ${defaultModel}`);
  const confirmPressed = await popup.locator("#mode-confirm").getAttribute("aria-pressed");
  if (confirmPressed !== "true") fail("默认划词模式不是先确认再翻");
  await popup.screenshot({ path: path.join(shots, "settings.png") });
  await popup.getByRole("button", { name: "测试连接" }).click();
  await popup.getByText("请先填写 API Key。不会假翻。").waitFor();
  await popup.locator("#api-key").fill("sk-invalid-smoke-key");
  await popup.locator("#custom-model").fill("qwen-turbo");
  const testDone = popup.waitForFunction(() => {
    const button = document.querySelector("#test");
    const errBox = document.querySelector("#err");
    const okBox = document.querySelector("#ok");
    if (button?.textContent?.includes("测试中")) window.__sawBusy = true;
    const visible = (errBox && !errBox.hasAttribute("hidden")) || (okBox && !okBox.hasAttribute("hidden"));
    return Boolean(window.__sawBusy) && !button?.textContent?.includes("测试中") && visible;
  }, null, { timeout: 25000 });
  await popup.getByRole("button", { name: "测试连接" }).click();
  await testDone;
  const banner = await popup.evaluate(() => {
    const visible = [...document.querySelectorAll("#err, #ok")].find((item) => !item.hasAttribute("hidden"));
    return visible?.textContent ?? "";
  });
  if (!banner.includes("不会假翻") && !banner.includes("千问已响应")) {
    fail(`测试连接结果不像真失败或真成功: ${banner}`);
  }
  if (banner.includes("假译文") || banner.includes("Hello")) fail("测试连接不该返回译文");
  await popup.getByRole("button", { name: "保存" }).click();
  await popup.getByText("已保存").waitFor();

  await popup.getByRole("button", { name: /术语本/ }).click();
  await popup.getByRole("heading", { name: "术语本" }).waitFor();
  await popup.locator("#term-source").fill("floating card");
  await popup.locator("#term-target").fill("浮层卡片");
  await popup.getByRole("button", { name: "添加" }).click();
  await popup.getByText("浮层卡片").waitFor();
  await popup.screenshot({ path: path.join(shots, "glossary.png") });
  await popup.getByRole("button", { name: "删" }).click();
  await popup.waitForTimeout(200);
  if (await popup.getByText("浮层卡片").count()) fail("术语没有删掉");

  const stored = await sw.evaluate(async () => chrome.storage.local.get("yifan.settings.v1"));
  const saved = stored["yifan.settings.v1"];
  if (saved.apiKey !== "sk-invalid-smoke-key") fail("Key 没有写进本地存储");
  if (saved.model !== "qwen-turbo") fail(`手填旧模型没有保存: ${saved.model}`);
  if (saved.selectionMode !== "confirm") fail(`划词模式被清掉了: ${saved.selectionMode}`);
  if (saved.glossary?.length) fail("删掉的术语还在");
  await sw.evaluate(async () => chrome.storage.local.remove("yifan.settings.v1"));

  console.log("smoke ok", { extensionId, banner: banner.replace(/\s+/g, " ").trim() });
} finally {
  await context.close();
  server.close();
}

async function shadowText(page, id) {
  return page.evaluate((hostId) => window.shadowPlain(hostId), id);
}

async function selectSample(page, selector) {
  await page.evaluate((sel) => {
    const node = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  }, selector);
}

async function tabIdFor(sw, url) {
  const tabs = await sw.evaluate(async () => {
    const all = await chrome.tabs.query({});
    return all.map((tab) => ({ id: tab.id, url: tab.url }));
  });
  const found = tabs.find((tab) => tab.url === url);
  if (!found?.id) throw new Error(`找不到示例页标签: ${JSON.stringify(tabs)}`);
  return found.id;
}
