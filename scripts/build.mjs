import { cp, mkdir, rm } from "node:fs/promises";
import esbuild from "esbuild";
import sharp from "sharp";

const banner = "/* 一翻 v0.1.11 · 本地 Key · 直连当前厂商 · 进页不自动翻 */";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/icons", { recursive: true });

const common = {
  bundle: true,
  format: "iife",
  target: ["chrome116"],
  platform: "browser",
  legalComments: "none",
  charset: "utf8",
  banner: { js: banner },
  logLevel: "info",
};

await esbuild.build({
  ...common,
  entryPoints: ["src/background/index.ts"],
  outfile: "dist/background.js",
});

await esbuild.build({
  ...common,
  entryPoints: ["src/content/index.ts"],
  outfile: "dist/content.js",
  loader: { ".css": "text" },
});

await esbuild.build({
  ...common,
  entryPoints: ["src/popup/main.ts"],
  outfile: "dist/popup.js",
});

await cp("src/manifest.json", "dist/manifest.json");
await cp("src/popup/popup.html", "dist/popup.html");
await cp("src/popup/popup.css", "dist/popup.css");
await cp("assets/brand-seal/icon-b1-128.png", "dist/icons/icon128.png");

for (const size of [16, 32, 48]) {
  await sharp("assets/brand-seal/icon-b1-512.png")
    .resize(size, size)
    .png()
    .toFile(`dist/icons/icon${size}.png`);
}

console.log("built dist/ — load unpacked in Chrome (chrome://extensions) or Edge (edge://extensions)");
