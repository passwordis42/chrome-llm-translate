import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

check(manifest.manifest_version === 3, "manifest_version");
check(manifest.name === "一翻", "name");
check(manifest.version === "0.1.1", "version");
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
check(content.includes("清除译文"), "inline clear control");
check(content.includes("data-yifan-inline"), "inline slot marker");
check(!content.includes("整页 AI 对照阅读"), "no side-by-side badge");
check(!content.includes("yifan-page"), "no overlay host");
check(!content.includes("sk-test"), "no test key baked into the bundle");

const background = readFileSync("dist/background.js", "utf8");
check(background.includes("dashscope.aliyuncs.com"), "qwen endpoint bundled");
check(background.includes("翻译选中内容"), "context menu copy bundled");
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
