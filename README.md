# 一翻

Chromium 扩展（Manifest V3）**v0.1.7**，同一份包可在 Chrome 和 Edge 加载。用你自己的通义千问 API Key 做划词翻译，并把整页原文在原文字位换成译文。划词默认先确认再请求模型。整页 AI 从主弹窗或右键直接开始，可停止后续翻。图片里的字可以框选识译，结果只在浮层里。不重要的整页可以确认后尝试浏览器自带翻译（留在原页，不跳转）。进页不自动翻，没有自建后端。

需求见 [docs/PRD.md](docs/PRD.md)。

## 加载（未打包）

1. 安装 Node.js 22+。
2. 在仓库根目录执行：

```bash
npm install
npm test
npm run build
```

3. 打开 `chrome://extensions`（Edge 见 [EDGE.md](EDGE.md)，入口是 `edge://extensions`）。
4. 打开右上角「开发者模式」。
5. 点「加载已解压的扩展程序」，选择本仓库的 **`dist/`** 目录（不是仓库根目录）。
6. 工具栏出现朱红印「翻」。已经打开的网页会在安装时注入监听；若划词没反应，刷新该页。

Chrome 和 Edge 加载的是同一个 `dist/`。可选：`npm run pack` 打出 `release/yifan-0.1.7-mv3.zip`，解压后再加载含 `manifest.json` 的那一层。

划词默认只弹出确认条；点「翻译」，或使用右键「翻译选中内容」，或把划词模式改成「划完即翻」之后，才会请求模型。整页 AI 点「开始」或右键后直接跑，没有二次确认。整页谷歌仍要确认。

## 填写 Key

1. 在阿里云百炼 / DashScope 控制台创建 API Key（中国站）。
2. 点工具栏图标，再点「设置」。
3. 粘贴 Key（输入框是密码框，只在本机扩展里保存）。
4. 模型默认 `qwen3.7-plus`（均衡）。设置里按三档精选：
   - 快速便宜：`qwen3.5-flash`、`qwen3.7-flash`、`qwen3.8-flash`
   - 均衡：`qwen3.5-plus`、`qwen3.6-plus`、`qwen3.7-plus`
   - 能力高：`qwen3.7-max`、`qwen3.8-max`
   也可以手填任意兼容 DashScope Chat Completions 的 model id。旧的 `qwen-turbo` / `qwen-plus` / `qwen-max` 不在精选里；已经保存的会原样继续用，也可以再手填。无效 id 或没有权限时只提示失败，不会编一句译文。划词和整页共用这一项。
5. 源语言默认「自动检测」，目标语言默认「中文」。划词翻译默认开。划词模式默认「先确认再翻」，可改成「划完即翻」。「允许划选被禁文字」默认关；只在你打开后，才强制放开站点禁划选的正文。关掉即停止强制。这几项在主弹窗「快捷」里就能改，写入后立刻对整页、划词和截图识译生效；设置页里仍有一份，改任意一边都会同步。
6. 截图识译使用单独的视觉模型，默认 `qwen3-vl-plus`，不出现在主弹窗，也不进文本三档。文本模型仍是上面的精选或手填。已保存的设置若手写了合法的 `visionModel`，识译会用它。
7. 点「测试连接」。失败会写明 Key 无效或网络不可达，**不会编一句假译文**。
8. 点「保存」。没保存的 Key 不会用于划词、整页和截图识译。

Key 存在 `chrome.storage.local`，只从扩展的 service worker 发到千问，不进网页，也不经过我们的服务器。

## 千问端点

兼容 OpenAI 的 Chat Completions，流式：

`POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`

- 头：`Authorization: Bearer <API Key>`
- 体：`model`、`messages`、`stream: true`、`temperature: 0.2`、`enable_thinking: false`（避免思考过程被当成译文）
- 解析：SSE，`choices[0].delta.content`，直到 `data: [DONE]`

常量在 `src/lib/endpoint.ts`。国际站（新加坡）Key 要把 host 改成 `dashscope-intl.aliyuncs.com`，然后重新 `npm run build`。`manifest.json` 里两个域名都已声明。

## 功能

| 能力 | 怎么用 |
| --- | --- |
| 划词翻译（默认开，默认先确认） | 选中网页文字后先出确认条：原文一行预览，主按钮「翻译」，以及关闭 / 取消。点「翻译」才请求模型，然后在浮层里流式显示译文。设置里可改回「划完即翻」。关掉划词总开关后，选中不再弹出。右键「翻译选中内容」仍直接翻。 |
| 允许划选被禁文字（默认关） | 设置里打开后，强制放开被站点禁止划选的正文，划词浮条仍按确认或立即模式。关掉后停止强制，站方限制可以恢复。不处理图片和 canvas。 |
| 整页 AI | 点工具栏图标后「开始」，或右键「整页 AI 翻译…」。直接跑，不再二次确认。先翻当前可见区，译文直接替换原文，不在段落下插盒子，也不做双语对照。往下滚、新字露出就自动续翻，每批最多 200 段。翻译中可在主弹窗或页内工具条「停止」：请求中断，已翻段落保留。停态页内工具条有「继续翻译」，和主弹窗再点「继续」一样，从未译段续翻。要整页重翻先「清除」。可复制本页已经替换出来的译文。没有全屏盖层，不锁滚动。 |
| 框选识译 | 主弹窗「截图识译」，或右键「框选识译…」。在当前页拖一个矩形，松手后截取这块可见区域，用 `qwen3-vl-plus` 识字，再按当前目标语言（默认中文）翻译。原文和译文在浮层里，可复制。不改页面正文，也不二次确认。Esc 取消框选。无 Key、网络失败或识不出字时只提示，不假翻。Chrome 的 `captureVisibleTab` 要求 `<all_urls>`，清单里因此保留这一项；仍然只上传你框出来的那一块。 |
| 整页谷歌 | 右键「整页谷歌翻译…」。确认后才动。只尝试唤起浏览器原页翻译；调不了就提示失败，不打开 translate.google.com，也不做 LLM 双语卡。 |
| 术语本 | 主弹窗或设置里「术语本」。固定译法优先：先换成占位符再交给模型，流式结果里换回你的译法。截图识出的字也会走这一步。 |
| 右键 | 翻译选中内容 / 整页 AI 翻译… / 整页谷歌翻译… / 框选识译… / 打开设置。 |
| 失败 | 浮层、识译面板或设置底部红条。无效 Key、断网、超时、识不出字都停下来，不假翻，也不改页面正文。 |

主弹窗放整页「开始 / 停止 / 清除」，以及源语言、目标语言、划词开关、划词模式、允许划选被禁文字、术语本和「截图识译」。API Key 和模型仍只在设置页，顶部可以返回主弹窗。页面右键、选区右键、工具栏图标右键仍能直接开始整页 AI。变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 谷歌翻译的限制

整页谷歌确认后留在原页，**不**打开 `translate.google.com`。

1. 若运行中的 Chrome 提供 `chrome.tabs.translate`，就用它唤起浏览器自带的原页翻译。
2. 没有这个接口，或调用失败：弹出失败说明，页面保持原样。
3. `chrome://`、扩展商店、PDF 等页面不能注入确认框，也不会被导航。

## 开发

```bash
npm test          # 划词确认、模型三档、术语本、SSE、失败不假翻、抽段、原位替换、滚动续翻、谷歌不跳转
npm run typecheck
npm run build     # 产出 dist/
npm run verify    # 检查 dist 能被 node --check
npm run check     # 上面全部
```

`npm run smoke` 会用本机 Chrome for Testing 打开 `dev/sample.html`，检查进页不自动翻、划词失败不假翻、确认后才原位替换（没 Key 时不改原文）、清除后原页仍可点击、谷歌确认不跳转、设置和术语本。品牌版 Chrome 从 137 起忽略命令行 `--load-extension`，脚本默认找 `YIFAN_CHROME`（否则 `/tmp/cft/chrome-linux64/chrome`）。日常加载仍用 `chrome://extensions` 的「加载已解压的扩展程序」。

图标用定稿 **B1** 朱红印（`#C8102E`，马善政「翻」）：`assets/brand-seal/icon-b1-128.png` / `icon-b1-512.png`。构建时生成 16 / 32 / 48，128 直接用定稿。`assets/brand/icon-a-*` 与 B1 是同一枚印，设置页和浮层用它。

## 在 Edge 里加载

和 Chrome 同一份构建。步骤见 [EDGE.md](EDGE.md)：`edge://extensions` → 开发人员模式 → 加载解压缩的扩展 → 选择 `dist/`。

## 不做

翻译历史、站点黑白名单、Firefox、进页自动翻译、进页自动截图、自建后端、DashScope 全量模型下拉、整桌或跨窗口截图、可见区一键识译、只识字不翻译、截图结果原位盖图。
