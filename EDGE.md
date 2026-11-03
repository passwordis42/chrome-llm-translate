# 在 Edge 里加载一翻

一翻 **v0.1.2** 是 Chromium Manifest V3 扩展。Chrome 和 Edge 用同一份 `dist/`，界面相同。没有单独的 Edge 清单，也不加 Firefox 才需要的 `browser_specific_settings`。

默认模型是 `qwen3.7-plus`。划词默认先出确认条，点「翻译」才请求模型。

## 准备

在仓库根目录：

```bash
npm install
npm test
npm run build
```

`dist/` 就是可加载的扩展目录（`manifest.json` 在这一层）。

打成 zip（可选，Chrome 和 Edge 都是解压后加载）：

```bash
npm run pack
```

产物：`release/yifan-0.1.2-mv3.zip`。解压后应直接看到 `manifest.json`。

## Edge

1. 打开 `edge://extensions`。
2. 打开「开发人员模式」（英文界面是 Developer mode）。
3. 点「加载解压缩的扩展」（英文界面是 Load unpacked）。
4. 选择 `dist/`，或 zip 解压后含 `manifest.json` 的那一层。不要选仓库根目录。
5. 工具栏出现「一翻」。已经打开的网页若划词没反应，刷新该页。

## Chrome

同一目录：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → `dist/`。

## 加载后看这三处

- 划词：先出确认条，未点「翻译」不请求；点后是原来的流式浮层。
- 整页 AI：确认后译文插在原页段落下，没有全屏盖层。
- 设置：可填 Key、在三档精选里选模型，或手填 model id。Edge 与 Chrome 是同一张设置页。
