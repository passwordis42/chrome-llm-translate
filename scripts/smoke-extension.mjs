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
    dialog: Boolean(document.getElementById("yifan-dialog")),
    bilingual: Boolean(document.getElementById("yifan-page")),
    sample: document.querySelector("#sample")?.textContent ?? "",
  }));
  if (early.float || early.dialog || early.bilingual) fail(`进页就改了 DOM: ${JSON.stringify(early)}`);
  if (!early.sample.includes("floating card")) fail("示例页原文丢失");

  await selectSample(page, "#sample");
  await page.locator("#yifan-float").waitFor({ timeout: 5000 });
  await page.waitForFunction((id) => window.shadowPlain(id).includes("不会假翻"), "yifan-float");
  const floatText = await shadowText(page, "yifan-float");
  if (!floatText.includes("不会假翻")) fail(`划词失败提示不对: ${floatText}`);
  if (!floatText.includes("When a sentence matters")) fail(`浮层没有原文: ${floatText}`);
  if (floatText.includes("插件会把")) fail("没有 Key 却出现了假译文");
  await page.locator("#yifan-float").screenshot({ path: path.join(shots, "float-error.png") });
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
  if (!aiCopy.includes("用千问翻译整页为") || !aiCopy.includes("并排双语")) fail(`整页 AI 确认文案不对: ${aiCopy}`);
  await page.locator("#yifan-dialog").screenshot({ path: path.join(shots, "confirm-ai.png") });
  await page.locator("#yifan-dialog").getByRole("button", { name: "取消" }).click();
  await aiCancel;
  await page.waitForTimeout(200);
  if (await page.locator("#yifan-page").count()) fail("取消整页 AI 之后仍然改了页面");
  if (page.url() !== pageUrl) fail(`取消后 URL 变了: ${page.url()}`);

  const aiRun = sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "show-page-ai" }), tabId);
  await page.locator("#yifan-dialog").getByRole("button", { name: "确认翻译" }).click();
  await page.locator("#yifan-page").waitFor({ timeout: 5000 });
  const bilingual = await shadowText(page, "yifan-page");
  if (!bilingual.includes("整页 AI 对照阅读")) fail("并排页缺少标题");
  if (!bilingual.includes("When a sentence matters")) fail("并排页没有保留原文");
  if (!bilingual.includes("不会假翻")) fail("没 Key 时并排页应明确失败");
  if (bilingual.includes("插件会把原文")) fail("并排页出现了假译文");
  const originalStillThere = await page.locator("article h1").textContent();
  if (!originalStillThere?.includes("Large language models")) fail("原文标题被替换了");
  await page.screenshot({ path: path.join(shots, "sidebyside.png") });
  await page.locator("#yifan-page").getByRole("button", { name: "退出对照" }).click();
  await page.locator("#yifan-page").waitFor({ state: "detached", timeout: 3000 });
  await aiRun;
  if (!(await page.locator("article h1").textContent())?.includes("Large language models")) {
    fail("退出对照后原文没了");
  }

  const googleCancel = sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "show-page-google" }), tabId);
  await page.locator("#yifan-dialog").waitFor();
  const googleCopy = await shadowText(page, "yifan-dialog");
  if (!googleCopy.includes("用浏览器自带") || !googleCopy.includes("打开谷歌翻译")) {
    fail(`谷歌确认文案不对: ${googleCopy}`);
  }
  await page.locator("#yifan-dialog").screenshot({ path: path.join(shots, "confirm-google.png") });
  await page.locator("#yifan-dialog").getByRole("button", { name: "取消" }).click();
  await googleCancel;
  if (page.url() !== pageUrl) fail("取消谷歌后页面被导航走了");
  if (await page.locator("#yifan-page").count()) fail("谷歌确认不该打开 LLM 并排");

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole("heading", { name: "一翻" }).waitFor();
  await popup.screenshot({ path: path.join(shots, "settings.png") });
  await popup.getByRole("button", { name: "测试连接" }).click();
  await popup.getByText("请先填写 API Key。不会假翻。").waitFor();
  await popup.locator("#api-key").fill("sk-invalid-smoke-key");
  await popup.locator("#model").selectOption("qwen-turbo");
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
  if (saved.model !== "qwen-turbo") fail("模型没有保存");
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
