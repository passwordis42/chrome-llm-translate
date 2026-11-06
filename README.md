# 一翻

Chromium 扩展（Manifest V3）**v0.1.13**，同一份包可在 Chrome 和 Edge 加载。用你自己的 API Key 做划词翻译，并把整页原文在原文字位换成译文。当前厂商可以是千问（百炼）、OpenAI、火山引擎（方舟）、DeepSeek 或 Kimi，五家 Key 分开保存，默认仍是千问，默认模型 `qwen3.7-plus`。划词开着时选完直接翻译。整页 AI 从主弹窗、右键、`Alt+T` 或右键拐角 ⌝ 直接开始，可停止后续翻。图片里的字可以框选识译，结果只在浮层里；`Alt+S` 或拐角 ⌟ 也能进入框选。`Alt+E` 或拐角 ⌞ 开关划词。当前厂商没有视觉模型时，入口会写明不可用。不重要的整页可以确认后尝试浏览器自带翻译（留在原页，不跳转）。进页不自动翻，没有自建后端。

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

Chrome 和 Edge 加载的是同一个 `dist/`。可选：`npm run pack` 打出 `release/yifan-0.1.13-mv3.zip`，解压后再加载含 `manifest.json` 的那一层。

划词开着时，选完直接请求模型，译文在原来的浮层里。没有原文预览确认条，也没有「翻译」确认键。关掉总开关后，选中不弹、不请求。右键「翻译选中内容」仍直接翻。整页 AI 点「开始」或右键后直接跑，没有二次确认。整页谷歌仍要确认。

## 填写 Key

1. 点工具栏图标，再点「设置」，先选「当前厂商」。五家的 Key 和模型分开存在本机，切换只换出这一家上次保存的配置。
2. 粘贴这一家的 API Key（密码框）。本版不填自定义 Base URL，也不收阿里云或火山的 AccessKey / AK/SK。
3. 模型用精选，或手填该家的 model id。火山还可以手填 `ep-` 开头的方舟接入点，手填优先于下拉。无效 id 或没有权限时只提示失败，不会编一句译文。
4. 千问（百炼）仍是默认厂商，默认模型 `qwen3.7-plus`（均衡）。三档精选：
   - 快速便宜：`qwen3.5-flash`、`qwen3.7-flash`、`qwen3.8-flash`
   - 均衡：`qwen3.5-plus`、`qwen3.6-plus`、`qwen3.7-plus`
   - 能力高：`qwen3.7-max`、`qwen3.8-max`
   旧的 `qwen-turbo` / `qwen-plus` / `qwen-max` 不在精选里；升级后原来的 Key 和模型进「千问」槽，已经保存的旧 id 会原样继续用。
5. OpenAI 精选 `gpt-4o-mini`（默认）、`gpt-4o`、`gpt-4.1`。火山精选 `doubao-seed-1.6`（默认）、`doubao-1.5-pro-32k`、`doubao-1.5-lite-32k`。DeepSeek 精选 `deepseek-chat`（默认）、`deepseek-reasoner`。Kimi（国内站）精选 `moonshot-v1-8k`（默认）、`moonshot-v1-32k`、`moonshot-v1-128k`。
6. 源语言默认「自动检测」，目标语言默认「中文」，都在设置页。设置页不再提供划词的两种模式。「启用鼠标手势」也在设置页，默认开。划词翻译默认开，主弹窗说明是「选中文字后直接翻译」。「允许划选被禁文字」默认关，术语本入口在主弹窗；改完立即写入。旧版本地设置里的确认模式会被忽略并清掉。
7. 额度行常驻在设置里。DeepSeek 查 `GET /user/balance`，Kimi 查 `GET /v1/users/me/balance`，用的就是聊天 Key。查到就显示账户余额。查失败会写成估算，并写上原因。OpenAI、千问、火山的聊天 Key 查不到账户余额，这里只显示本次和本扩展累计估算，角标是「估算」，不会假装成账单余额。单价是 `src/lib/pricing.ts` 里的粗表。响应里没有 `usage` 时只记次数，不编金额。
8. 截图识译跟当前厂商。千问用单独的视觉模型，默认 `qwen3-vl-plus`，不出现在主弹窗，也不进文本三档。OpenAI 和火山用当前选中的模型（火山的 `ep-` 也按这个模型去识图，不行就诚实失败）。DeepSeek 和 Kimi 本版没有视觉模型，主弹窗「截图识译」禁用，并提示「当前厂商不支持截图识译」；`Alt+S` 和拐角 ⌟ 同样只提示。已保存的千问 `visionModel` 仍然只给千问用。
9. 点「测试连接」。失败会写明 Key 无效或网络不可达，**不会编一句假译文**。
10. 点「保存」。没保存的 Key 不会用于划词、整页和截图识译。切换厂商时，当前表单会先写入这一家的槽。

Key 存在 `chrome.storage.local`，只从扩展的 service worker 发到当前厂商，不进网页，也不经过我们的服务器。

## 厂商端点

都是 OpenAI 兼容的 Chat Completions，`Authorization: Bearer <API Key>`。地址固定，设置里不能改。

| 厂商 | Chat Completions | 余额 |
| --- | --- | --- |
| 千问 | `POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | 无。聊天 Key 查不到余额 |
| OpenAI | `POST https://api.openai.com/v1/chat/completions` | 无。普通 `sk-` 查不到账单 |
| 火山引擎 | `POST https://ark.cn-beijing.volces.com/api/v3/chat/completions` | 无。不收 AK/SK |
| DeepSeek | `POST https://api.deepseek.com/chat/completions` | `GET https://api.deepseek.com/user/balance` |
| Kimi | `POST https://api.moonshot.cn/v1/chat/completions` | `GET https://api.moonshot.cn/v1/users/me/balance` |

千问的请求体仍带 `enable_thinking: false`，避免思考过程被当成译文。其他厂商不传这个字段。流式解析 SSE 的 `choices[0].delta.content`，直到 `data: [DONE]`；最后一包里的 `usage` 用来做本地估算。

千问常量在 `src/lib/endpoint.ts`，五家目录在 `src/lib/providers.ts`，估算单价在 `src/lib/pricing.ts`，余额解析在 `src/lib/quota.ts`。国际站（新加坡）千问 Key 要把千问 host 改成 `dashscope-intl.aliyuncs.com`，然后重新 `npm run build`。`manifest.json` 里中国站和国际站两个域名都已声明。

## 功能

| 能力 | 怎么用 |
| --- | --- |
| 划词翻译（默认开） | 划词开关开着时，选中网页文字后直接请求模型，在原来的浮层里流式显示译文。没有原文预览确认条，也没有「翻译」确认键。关掉划词总开关（主弹窗、`Alt+E` 或右键拐角 ⌞）后，选中不再弹出，也不请求。右键「翻译选中内容」仍直接翻。 |
| 允许划选被禁文字（默认关） | 主弹窗打开后，强制放开被站点禁止划选的正文。划词仍看总开关：开着就直接翻。关掉后停止强制，站方限制可以恢复。不处理图片和 canvas。 |
| 整页 AI | 点工具栏图标后「开始」，右键「整页 AI 翻译…」，或按 `Alt+T`（设置里可改）。停态或未完成时这就是继续，已翻保留，没有二次确认。先翻当前可见区，译文直接替换原文，不在段落下插盒子，也不做双语对照。往下滚、新字露出就自动续翻，每批最多 200 段。翻译中可在主弹窗或页内工具条「停止」：请求中断，已翻段落保留。停态页内工具条有「继续翻译」，和主弹窗再点「继续」一样，从未译段续翻。要整页重翻先「清除」。可复制本页已经替换出来的译文。没有全屏盖层，不锁滚动。 |
| 框选识译 | 主弹窗「截图识译」、右键「框选识译…」，或按 `Alt+S`（设置里可改）。当前厂商没有视觉模型时，按钮禁用并提示「当前厂商不支持截图识译」，快捷键和拐角同样只提示、不开始框选。有视觉能力时，在当前页拖一个矩形，松手后截取这块可见区域。千问默认用 `qwen3-vl-plus` 识字；OpenAI 和火山用当前模型。再按当前目标语言（默认中文）翻译。原文和译文在浮层里，可复制。出结果后可以拖标题栏挪位置、拖边角改大小；边角把手默认不画，鼠标移到原来的热区才显示，离开且没在拖就再隐。A−/A+ 只改这扇窗里的正文字号（默认 13px，约 12–22）；「放大 / 还原」只改窗口（约 400↔560），不改字号。关掉再开回到右下角和默认大小，不记住。正在识字时不能拖改。不改页面正文，也不二次确认。Esc 取消框选。无 Key、网络失败或识不出字时只提示，不假翻。Chrome 的 `captureVisibleTab` 要求 `<all_urls>`，清单里因此保留这一项；仍然只上传你框出来的那一块。 |
| 键盘快捷键 | 扩展自己保存三条默认键：`Alt+T` 整页开始/继续，`Alt+S` 进入框选识译，`Alt+E` 翻转划词开关。安装或升级后即可用，不必先去浏览器快捷键页。设置里点「改键」听下一组修饰键加主键，Esc 取消；和另一条相同会拒绝并保留原键。「恢复默认」回到 Alt+T / Alt+S / Alt+E。主弹窗 tip 显示当前生效的键。也可在 `chrome://extensions/shortcuts`（Edge 为 `edge://extensions/shortcuts`）改系统级命令，页面里的触发和 tip 以扩展内设置为准。无 Key 时整页和识译会提示；划词开关不需要 Key。当前是 `chrome://` / `edge://` 等不能注入的页面，会提示原因，不静默失败。当前厂商不能识图时，识译键只提示。 |
| 鼠标拐角 | 设置里「启用鼠标手势」默认开。在网页上按住右键，拖出恰好一个直角后松开：⌝（先右再下）整页开始/继续，⌟（先下再右）截图识译，⌞（先下再左）划词开/关。两段都要至少 48px，夹角离直角不超过 28°。直线、反方向、斜线、多拐或太短不触发，系统右键菜单仍会出现。识别成功才不弹出右键菜单。左键划词和框选拖框不受影响。关掉开关后三条拐角都不触发，快捷键和按钮仍可用。不能识图时 ⌟ 只提示。手势不能自定义。 |
| 整页谷歌 | 右键「整页谷歌翻译…」。确认后才动。只尝试唤起浏览器原页翻译；调不了就提示失败，不打开 translate.google.com，也不做 LLM 双语卡。 |
| 术语本 | 主弹窗「术语本」。固定译法优先：先换成占位符再交给模型，流式结果里换回你的译法。截图识出的字也会走这一步。 |
| 右键 | 翻译选中内容 / 整页 AI 翻译… / 整页谷歌翻译… / 框选识译… / 打开设置。 |
| 失败 | 浮层、识译面板或设置底部红条。无效 Key、断网、超时、401/402、额度不足、识不出字都停下来，不假翻，也不改页面正文。 |

主弹窗放整页「开始 / 停止 / 清除」、划词开关、允许划选被禁文字、术语本、「截图识译」，以及一行快捷 tip（`Alt+T` 整页 · `Alt+S` 识译 · `Alt+E` 划词 · 右键 ⌝/⌟/⌞）。源语言、目标语言、三条快捷键和「启用鼠标手势」在设置页。API Key 和模型仍只在设置页，顶部可以返回主弹窗。设置页不再重复主弹窗已有的划词开关、禁选和术语本，也不再放划词的两种模式。页面右键、选区右键、工具栏图标右键仍能直接开始整页 AI。变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 谷歌翻译的限制

整页谷歌确认后留在原页，**不**打开 `translate.google.com`。

1. 若运行中的 Chrome 提供 `chrome.tabs.translate`，就用它唤起浏览器自带的原页翻译。
2. 没有这个接口，或调用失败：弹出失败说明，页面保持原样。
3. `chrome://`、扩展商店、PDF 等页面不能注入确认框，也不会被导航。

## 开发

```bash
npm test          # 划词直接翻、模型三档、术语本、SSE、失败不假翻、抽段、原位替换、滚动续翻、谷歌不跳转
npm run typecheck
npm run build     # 产出 dist/
npm run verify    # 检查 dist 能被 node --check
npm run check     # 上面全部
```

`npm run smoke` 会用本机 Chrome for Testing 打开 `dev/sample.html`，检查进页不自动翻、划词开着时直接出浮层且不假翻、关掉后不弹、右键选中仍直接翻、整页没 Key 时不改原文、清除后原页仍可点击、谷歌确认不跳转、设置和术语本。品牌版 Chrome 从 137 起忽略命令行 `--load-extension`，脚本默认找 `YIFAN_CHROME`（否则 `/tmp/cft/chrome-linux64/chrome`）。日常加载仍用 `chrome://extensions` 的「加载已解压的扩展程序」。

图标用定稿 **B1** 朱红印（`#C8102E`，马善政「翻」）：`assets/brand-seal/icon-b1-128.png` / `icon-b1-512.png`。构建时生成 16 / 32 / 48，128 直接用定稿。`assets/brand/icon-a-*` 与 B1 是同一枚印，设置页和浮层用它。

## 在 Edge 里加载

和 Chrome 同一份构建。步骤见 [EDGE.md](EDGE.md)：`edge://extensions` → 开发人员模式 → 加载解压缩的扩展 → 选择 `dist/`。

## 不做

翻译历史、站点黑白名单、Firefox、进页自动翻译、进页自动截图、自建后端、DashScope 全量模型下拉、整桌或跨窗口截图、可见区一键识译、只识字不翻译、截图结果原位盖图、自定义 Base URL、阿里云或火山 AccessKey（AK/SK）、OpenAI Admin Key、日限额告警、余额推送、充值入口。
