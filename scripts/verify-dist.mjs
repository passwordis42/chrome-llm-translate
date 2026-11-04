import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

check(manifest.manifest_version === 3, "manifest_version");
check(manifest.name === "一翻", "name");
check(manifest.version === "0.1.7", "version");
check(manifest.content_scripts?.[0]?.run_at === "document_start", "content script starts early enough to beat select bans");
check(manifest.background?.service_worker === "background.js", "service worker");
check(manifest.content_scripts?.[0]?.js?.[0] === "content.js", "content script");
check(manifest.action?.default_popup === "popup.html", "popup");
check(manifest.permissions?.includes("storage"), "storage permission");
check(manifest.permissions?.includes("contextMenus"), "context menu permission");
check(!manifest.permissions?.includes("history"), "no history permission");

for (const file of [
  "dist/background.js",
  "dist/content.js",
  "dist/popup.html",
  "dist/popup.js",
  "dist/popup.css",
  "dist/icons/icon16.png",
  "dist/icons/icon32.png",
  "dist/icons/icon48.png",
  "dist/icons/icon128.png",
]) {
  check(existsSync(file), `missing ${file}`);
}

const content = readFileSync("dist/content.js", "utf8");
check(content.includes("不会假翻"), "content keeps the honest-failure copy");
check(content.includes("一翻 · 划词"), "float title");
check(content.includes("一翻 · 确认翻译"), "selection confirm title");
check(content.includes("关闭确认条"), "selection confirm close label");
check(content.includes("清除译文"), "inline clear control");
check(content.includes("复制全部译文"), "copy all translations");
check(content.includes("停止"), "inline stop control");
check(content.includes("继续翻译"), "inline continue control");
check(content.includes("框选识译"), "crop badge");
check(content.includes("截图识译"), "ocr panel title");
check(content.includes("只上传这个选区，用你自己的 Key。不改页面正文。"), "ocr privacy");
check(content.includes("已停止 · 已翻保留"), "stopped status");
check(content.includes("翻译中…"), "running status");
check(content.includes("译文直接替换原文；下滑自动续翻；清除可还原"), "toolbar meta");
check(content.includes("继续下滑将自动续翻未译段落（每批最多 200 段）"), "scroll hint");
check(content.includes("唤起页面翻译"), "google confirm remains");
check(!content.includes('showConfirm("ai")') && !content.includes("需确认后才会开始翻译"), "page AI has no second confirm");
check(content.includes("data-yifan-replaced"), "in-place marker");
check(!content.includes("data-yifan-inline"), "no inline slot marker");
check(!content.includes("退出对照"), "no exit-bilingual control");
check(!content.includes("段落下方"), "no below-paragraph confirm");
check(!content.includes("整页 AI 对照阅读"), "no side-by-side badge");
check(!content.includes("yifan-page"), "no overlay host");
check(!content.includes("sk-test"), "no test key baked into the bundle");
check(content.includes("yifan-force-select"), "force-select style id");
check(content.includes("-webkit-user-select"), "webkit user-select override");

const popup = readFileSync("dist/popup.html", "utf8");
check(popup.includes("先确认再翻"), "confirm mode copy");
check(popup.includes("划完即翻"), "immediate mode copy");
check(popup.includes("qwen3.7-plus"), "default curated model");
check(popup.includes("快速便宜") && popup.includes("均衡") && popup.includes("能力高"), "model tier labels");
check(!popup.includes('value="qwen-turbo"') && !popup.includes('value="qwen-plus"') && !popup.includes('value="qwen-max"'), "legacy ids stay out of the curated select");
check(popup.includes("允许划选被禁文字"), "force-select title");
check(popup.includes("站点禁划选时强制放开，方便划词；默认关，进禁选页再开"), "force-select description");
check(popup.includes('class="new-tag"'), "force-select new tag");
check(popup.includes('id="force-select-toggle"'), "force-select toggle");
check(popup.includes('aria-checked="false"'), "force-select defaults off");
check(popup.includes("允许划选被禁文字，已关闭"), "force-select closed label");
check(popup.includes('id="home-view"'), "home view");
const home = popup.slice(popup.indexOf('id="home-view"'), popup.indexOf('id="settings-view"'));
check(home.includes("快捷") && home.includes("截图识译") && home.includes("先确认再翻"), "home shortcuts");
check(!home.includes("api-key") && !home.includes("qwen3.7-plus") && !home.includes('id="model"'), "home has no key or model");
check(popup.includes('id="start-page"') && popup.includes('id="stop-page"') && popup.includes('id="clear-page"'), "start stop clear");
check(popup.includes('id="back-home"'), "settings back");
check(popup.includes("返回主弹窗"), "settings back label");
check(popup.includes("点开始，整页原位换成译文"), "idle hint");
const popupJs = readFileSync("dist/popup.js", "utf8");
check(popupJs.includes("page-ai-start") && popupJs.includes("page-ai-stop") && popupJs.includes("page-ai-clear"), "popup commands");

const background = readFileSync("dist/background.js", "utf8");
check(background.includes("dashscope.aliyuncs.com"), "qwen endpoint bundled");
check(background.includes("qwen3.7-plus"), "default model bundled");
check(background.includes("翻译选中内容"), "context menu copy bundled");
check(background.includes("框选识译…"), "crop context menu");
check(background.includes("captureVisibleTab"), "visible tab capture");
check(background.includes("qwen3-vl-plus"), "default vision model");
check(background.includes("没有跳转到 translate.google.com"), "google failure stays on the page");
check(!background.includes("chrome.tabs.update"), "background does not navigate tabs");
check(!background.includes("translate.google.com/translate"), "no google translate navigation url");

for (const file of ["dist/background.js", "dist/content.js", "dist/popup.js"]) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  check(result.status === 0, `syntax ${file}\n${result.stderr}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("dist ok");
