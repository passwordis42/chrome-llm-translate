import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

if (!existsSync("dist/manifest.json")) {
  console.error("缺少 dist/manifest.json，先执行 npm run build");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
const releaseDir = path.resolve("release");
mkdirSync(releaseDir, { recursive: true });
const out = path.join(releaseDir, `yifan-${manifest.version}-mv3.zip`);
const result = spawnSync("zip", ["-r", "-q", out, "."], { cwd: "dist", stdio: "inherit" });
if (result.status !== 0) {
  console.error("zip 失败。需要系统里有 zip 命令。");
  process.exit(result.status ?? 1);
}
console.log(`packed ${out} — unzip, then load unpacked in Chrome or Edge`);
