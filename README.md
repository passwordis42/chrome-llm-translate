# 一翻

Chrome 扩展（Manifest V3）**v0.1.1**。用你自己的通义千问 API Key 做划词翻译，并在原网页段落下方插入整页译文。不重要的整页可以确认后尝试浏览器自带翻译（留在原页，不跳转）。进页不自动翻，没有自建后端。

需求见 [docs/PRD.md](docs/PRD.md)。

## 加载（未打包）

1. 安装 Node.js 22+。
2. 在仓库根目录执行：

```bash
npm install
npm test
npm run build
```

3. 打开 `chrome://extensions`。
4. 打开右上角「开发者模式」。
5. 点「加载已解压的扩展程序」，选择本仓库的 **`dist/`** 目录（不是仓库根目录）。
6. 工具栏出现朱红印「翻」。已经打开的网页会在安装时注入监听；若划词没反应，刷新该页。

扩展只在你选中文字、或点右键里的整页项并确认之后才会请求翻译。

## 填写 Key

1. 在阿里云百炼 / DashScope 控制台创建 API Key（中国站）。
2. 点工具栏图标，打开设置。
3. 粘贴 Key（输入框是密码框，只在本机扩展里保存）。
4. 模型默认 `qwen-plus`，也可以选 `qwen-turbo` / `qwen-max`。
5. 源语言默认「自动检测」，目标语言默认「中文」。划词翻译默认开。
6. 点「测试连接」。失败会写明 Key 无效或网络不可达，**不会编一句假译文**。
7. 点「保存」。没保存的 Key 不会用于划词和整页。

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
| 划词翻译（默认开） | 选中网页文字，浮层里原文 + 流式译文。可复制译文、改目标语言、关闭。设置里关掉之后，选中不再弹出。 |
| 整页 AI | 右键「整页 AI 翻译…」，或工具栏图标右键。确认后才跑。原文留在原处，译文插在段落下。没有全屏盖层，不锁滚动。可清除译文，可复制全部译文。 |
| 整页谷歌 | 右键「整页谷歌翻译…」。确认后才动。只尝试唤起浏览器原页翻译；调不了就提示失败，不打开 translate.google.com，也不做 LLM 双语卡。 |
| 术语本 | 设置里「术语本」。固定译法优先：先换成占位符再交给模型，流式结果里换回你的译法。 |
| 右键 | 翻译选中内容 / 整页 AI 翻译… / 整页谷歌翻译… / 打开设置。 |
| 失败 | 浮层或设置底部红条。无效 Key、断网、超时都停下来，不假翻。 |

整页入口不在设置卡片上，避免和已定稿的设置页挤在一起。页面右键、选区右键、工具栏图标右键都能到。

## 谷歌翻译的限制

整页谷歌确认后留在原页，**不**打开 `translate.google.com`。

1. 若运行中的 Chrome 提供 `chrome.tabs.translate`，就用它唤起浏览器自带的原页翻译。
2. 没有这个接口，或调用失败：弹出失败说明，页面保持原样。
3. `chrome://`、扩展商店、PDF 等页面不能注入确认框，也不会被导航。

## 开发

```bash
npm test          # 术语本、SSE、失败不假翻、抽段、段下插、谷歌不跳转、菜单文案
npm run typecheck
npm run build     # 产出 dist/
npm run verify    # 检查 dist 能被 node --check
npm run check     # 上面全部
```

`npm run smoke` 会用本机 Chrome for Testing 打开 `dev/sample.html`，检查进页不自动翻、划词失败不假翻、确认后才在段落下插入译文、清除后原页仍可点击、谷歌确认不跳转、设置和术语本。品牌版 Chrome 从 137 起忽略命令行 `--load-extension`，脚本默认找 `YIFAN_CHROME`（否则 `/tmp/cft/chrome-linux64/chrome`）。日常加载仍用 `chrome://extensions` 的「加载已解压的扩展程序」。

图标用定稿 **B1** 朱红印（`#C8102E`，马善政「翻」）：`assets/brand-seal/icon-b1-128.png` / `icon-b1-512.png`。构建时生成 16 / 32 / 48，128 直接用定稿。`assets/brand/icon-a-*` 与 B1 是同一枚印，设置页和浮层用它。

## 不做

翻译历史、站点黑白名单、Edge / Firefox、进页自动翻译、自建后端。
