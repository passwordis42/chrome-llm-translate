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
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--no-first-run",
    "--disable-default-apps",
    "--disable-sync",
    "--no-sandbox",
    "--disable-dev-shm-usage",
  ],
});

function fail(message) {
  throw new Error(message);
}

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

  const aiRun = sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "show-page-ai" }), tabId);
  await page.locator("#yifan-inline-bar").waitFor({ timeout: 5000 });
  if (await page.locator("#yifan-dialog").count()) fail("整页 AI 不应再弹出二次确认");
  await page.waitForFunction((id) => window.shadowPlain(id).includes("不会假翻"), "yifan-inline-bar");
  const barText = await shadowText(page, "yifan-inline-bar");
  if (!barText.includes("译文直接替换原文；下滑自动续翻；清除可还原")) fail(`工具条说明不对: ${barText}`);
  if (!barText.includes("继续翻译")) fail(`停态工具条没有继续翻译: ${barText}`);
  if (!barText.includes("复制全部译文") || !barText.includes("清除译文")) {
    fail(`工具条按钮不对: ${barText}`);
  }
  if (barText.includes("退出对照") || barText.includes("段落下")) fail(`工具条还是旧文案: ${barText}`);
  if (!barText.includes("不会假翻")) fail("没 Key 时工具条应写明失败");
  if (await page.locator("[data-yifan-inline]").count()) fail("整页 AI 仍在段落下插译文");
  if (await page.locator("[data-yifan-replaced]").count()) fail("没 Key 时不应原位替换");
  const sampleText = await page.locator("#sample").textContent();
  if (!sampleText?.includes("When a sentence matters")) fail("没 Key 时原文被替换了");
  if (sampleText?.includes("不会假翻")) fail("失败提示写进了原文");
  await page.locator("#yifan-inline-bar").getByRole("button", { name: "继续翻译" }).click();
  await page.waitForTimeout(400);
  if (await page.locator("[data-yifan-replaced]").count()) fail("继续翻译在没 Key 时不应原位替换");
  if (!(await page.locator("#sample").textContent())?.includes("When a sentence matters")) fail("继续翻译改了原文");
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

  const cropOpen = sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "start-crop-ocr" }), tabId);
  await page.locator("#yifan-crop").waitFor({ timeout: 5000 });
  const cropText = await shadowText(page, "yifan-crop");
  if (!cropText.includes("框选识译") || !cropText.includes("Esc")) fail(`框选态文案不对: ${cropText}`);
  if (!cropText.includes("不改页面正文")) fail(`框选没有隐私说明: ${cropText}`);
  await page.keyboard.press("Escape");
  await page.locator("#yifan-crop").waitFor({ state: "detached", timeout: 3000 });
  await cropOpen;
  if (!(await page.locator("#sample").textContent())?.includes("When a sentence matters")) fail("取消框选改了正文");

  await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "start-crop-ocr" }), tabId);
  await page.locator("#yifan-crop").waitFor({ timeout: 5000 });
  const hostBox = await page.locator("#yifan-crop").boundingBox();
  if (!hostBox) fail("框选层没有尺寸");
  await page.mouse.move(hostBox.x + 180, hostBox.y + 150);
  await page.mouse.down();
  await page.mouse.move(hostBox.x + 460, hostBox.y + 300, { steps: 8 });
  await page.mouse.up();
  await page.locator("#yifan-ocr").waitFor({ timeout: 15000 });
  const ocrText = await shadowText(page, "yifan-ocr");
  if (!ocrText.includes("API Key") || !ocrText.includes("不会假翻")) fail(`没 Key 的识译应失败: ${ocrText}`);
  if (ocrText.includes("截不到当前页面")) fail(`选区没有截下来: ${ocrText}`);
  if (ocrText.includes("假译文")) fail(`识译出现了假译文: ${ocrText}`);
  if (await page.locator("[data-yifan-replaced]").count()) fail("识译改了页面正文");
  if (!(await page.locator("#sample").textContent())?.includes("When a sentence matters")) fail("识译后原文丢了");
  await page.keyboard.press("Escape");
  await page.locator("#yifan-ocr").waitFor({ state: "detached", timeout: 3000 });

  await exerciseShortcuts(page, sw, tabId);

  await sw.evaluate(async () => chrome.storage.local.remove("yifan.settings.v1"));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole("heading", { name: "设置" }).waitFor();
  await popup.getByRole("button", { name: "返回主弹窗" }).click();
  await popup.getByRole("heading", { name: "一翻" }).waitFor();
  await popup.getByRole("button", { name: "开始" }).waitFor();
  await popup.getByRole("button", { name: "停止" }).waitFor();
  await popup.getByRole("button", { name: "清除" }).waitFor();
  await popup.getByRole("button", { name: /截图识译/ }).waitFor();
  if (await popup.locator("#api-key").isVisible()) fail("主弹窗不该出现 API Key");
  if (await popup.locator("#model").isVisible()) fail("主弹窗不该出现模型选择");
  if (await popup.locator("#home-target-lang").count()) fail("主弹窗不该再放目标语言");
  if (await popup.locator("#home-mode-confirm").count()) fail("主弹窗不该再放划词模式");
  await popup.locator("#hotkey-tip").waitFor();
  const tip = (await popup.locator("#hotkey-tip").innerText()).replace(/\s+/g, " ");
  if (!tip.includes("Alt+T") || !tip.includes("Alt+S") || !tip.includes("Alt+E") || !tip.includes("⌞")) {
    fail(`tip 没有三键和三角手势: ${tip}`);
  }
  if (tip.includes("未设置")) fail(`tip 出现了未设置: ${tip}`);
  await popup.getByRole("button", { name: "设置", exact: true }).click();
  await popup.getByRole("heading", { name: "设置" }).waitFor();
  const gestureOn = await popup.locator("#gesture-toggle").getAttribute("aria-checked");
  if (gestureOn !== "true") fail("鼠标手势默认应开启");
  const gestureDesc = await popup.locator("#gesture-row .t-desc").innerText();
  if (!gestureDesc.includes("⌞") || !gestureDesc.includes("划词开/关")) fail(`手势说明不对: ${gestureDesc}`);
  if (await popup.locator("#settings-view #home-selection-toggle").count()) fail("设置页不该镜像划词开关");
  await exerciseRebind(popup);
  await popup.locator("#target-lang").selectOption("ja");
  await popup.waitForTimeout(300);
  const picked = await sw.evaluate(async () => {
    const bag = await chrome.storage.local.get("yifan.settings.v1");
    return bag["yifan.settings.v1"]?.targetLang ?? "";
  });
  if (picked !== "ja") fail(`设置页目标语言没有马上写入: ${picked}`);
  await popup.locator("#target-lang").selectOption("zh");
  await popup.waitForTimeout(200);
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

  await popup.getByRole("button", { name: "返回主弹窗" }).click();
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

async function exerciseShortcuts(page, sw, tabId) {
  await selectSample(page, "#sample");
  await page.locator("#yifan-select-confirm").waitFor({ timeout: 5000 });
  await page.keyboard.press("Alt+E");
  await page.waitForFunction((id) => window.shadowPlain(id).includes("划词已关"), "yifan-toast");
  await page.locator("#yifan-select-confirm").waitFor({ state: "detached", timeout: 3000 });
  await selectSample(page, "#second");
  await page.waitForTimeout(400);
  if (await page.locator("#yifan-select-confirm").count()) fail("Alt+E 关掉划词后仍出确认条");
  if (await page.locator("#yifan-float").count()) fail("Alt+E 关掉划词后仍出浮层");

  const running = sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "page-ai-start" }), tabId);
  await page.locator("#yifan-inline-bar").waitFor({ timeout: 5000 });
  await page.keyboard.press("Alt+E");
  await page.waitForFunction((id) => window.shadowPlain(id).includes("划词已开"), "yifan-toast");
  if (!(await page.locator("#yifan-inline-bar").count())) fail("划词开关打断了整页翻译");
  await page.locator("#yifan-inline-bar").getByRole("button", { name: "清除译文" }).click();
  await page.locator("#yifan-inline-bar").waitFor({ state: "detached", timeout: 3000 });
  await running;

  await dragCorner(page, "page");
  await page.locator("#yifan-dialog").waitFor({ timeout: 5000 });
  const pageNotice = await shadowText(page, "yifan-dialog");
  if (!pageNotice.includes("API Key")) fail(`⌝ 没有走到整页: ${pageNotice}`);
  await page.locator("#yifan-dialog").getByRole("button", { name: "关闭" }).click();
  await page.locator("#yifan-dialog").waitFor({ state: "detached", timeout: 3000 });

  await dragCorner(page, "selection");
  await page.waitForFunction((id) => window.shadowPlain(id).includes("划词已关"), "yifan-toast");
  const afterCorner = await readSelectionEnabled(sw);
  if (afterCorner !== false) fail("⌞ 没有关掉划词");
  await page.locator("#yifan-toast").waitFor({ state: "detached", timeout: 3000 });

  await sw.evaluate(async () => {
    const bag = await chrome.storage.local.get("yifan.settings.v1");
    const current = bag["yifan.settings.v1"];
    current.gestureEnabled = false;
    current.selectionEnabled = true;
    await chrome.storage.local.set({ "yifan.settings.v1": current });
  });
  await page.waitForTimeout(250);
  for (const kind of ["selection", "page", "crop"]) {
    await dragCorner(page, kind);
    await page.waitForTimeout(250);
    if (await page.locator("#yifan-toast").count()) fail(`关掉手势后 ${kind} 仍出划词提示`);
    if (await page.locator("#yifan-inline-bar").count()) fail(`关掉手势后 ${kind} 仍触发整页`);
    if (await page.locator("#yifan-crop").count()) fail(`关掉手势后 ${kind} 仍触发识译`);
    if (await page.locator("#yifan-dialog").count()) fail(`关掉手势后 ${kind} 仍弹出说明`);
    await page.keyboard.press("Escape");
  }
  if ((await readSelectionEnabled(sw)) !== true) fail("关掉手势后划词开关被改了");
  await page.keyboard.press("Alt+E");
  await page.waitForFunction((id) => window.shadowPlain(id).includes("划词已关"), "yifan-toast");
  if ((await readSelectionEnabled(sw)) !== false) fail("关掉手势后 Alt+E 也不再翻转划词");
}

async function exerciseRebind(popup) {
  if ((await popup.locator("#hk-page").innerText()) !== "Alt+T") fail("整页默认键不是 Alt+T");
  if ((await popup.locator("#hk-crop").innerText()) !== "Alt+S") fail("识译默认键不是 Alt+S");
  if ((await popup.locator("#hk-selection").innerText()) !== "Alt+E") fail("划词默认键不是 Alt+E");
  await popup.locator("#rebind-crop").click();
  await popup.locator("#hk-crop.listening").waitFor();
  const listening = await popup.locator("#hk-crop").innerText();
  if (!listening.includes("按下新组合键")) fail(`改键态不对: ${listening}`);
  await popup.keyboard.press("Escape");
  if ((await popup.locator("#hk-crop").innerText()) !== "Alt+S") fail("Esc 取消后识译键丢了");
  await popup.locator("#rebind-crop").click();
  await popup.locator("#hk-crop.listening").waitFor();
  await popup.keyboard.press("Alt+T");
  await popup.locator("#hk-error").waitFor();
  const conflict = await popup.locator("#hk-error").innerText();
  if (!conflict.includes("整页开始/继续") || !conflict.includes("没有改掉当前键")) fail(`冲突提示不对: ${conflict}`);
  if ((await popup.locator("#hk-crop").innerText()) !== "Alt+S") fail("冲突后识译键被改掉了");
  await popup.locator("#rebind-selection").click();
  await popup.locator("#hk-selection.listening").waitFor();
  await popup.keyboard.press("Control+Shift+Y");
  await popup.locator("#hk-selection").filter({ hasText: "Ctrl+Shift+Y" }).waitFor();
  const tipped = await popup.locator("#hotkey-selection").textContent();
  if (tipped !== "Ctrl+Shift+Y") fail(`tip 没有跟着改键: ${tipped}`);
  if ((await popup.locator("#hotkey-tip").textContent())?.includes("未设置")) fail("改键后 tip 出现未设置");
  await popup.locator("#restore-shortcuts").click();
  await popup.locator("#hk-selection").filter({ hasText: "Alt+E" }).waitFor();
  if ((await popup.locator("#hk-page").innerText()) !== "Alt+T") fail("恢复默认后整页键不对");
  if ((await popup.locator("#hk-crop").innerText()) !== "Alt+S") fail("恢复默认后识译键不对");
  if ((await popup.locator("#hotkey-selection").textContent()) !== "Alt+E") fail("恢复默认后 tip 没有回到 Alt+E");
}

async function readSelectionEnabled(sw) {
  return sw.evaluate(async () => {
    const bag = await chrome.storage.local.get("yifan.settings.v1");
    return bag["yifan.settings.v1"]?.selectionEnabled;
  });
}

async function dragCorner(page, kind) {
  const start = { x: 460, y: 200 };
  const corner = kind === "page" ? { x: 640, y: 200 } : { x: 460, y: 380 };
  const end = kind === "page" ? { x: 640, y: 380 } : kind === "crop" ? { x: 660, y: 380 } : { x: 260, y: 380 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(corner.x, corner.y, { steps: 12 });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up({ button: "right" });
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
