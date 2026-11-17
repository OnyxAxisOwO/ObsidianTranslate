# Obsidian Translate

使用自定义模型 API 的开源浏览器翻译扩展，采用 MIT 协议。扩展支持 Chrome、Firefox 和 Safari，界面参考 Obsidian Arc 的无描边面板、浅深色主题和过渡动效。

## 预览

```sh
npm ci
npm run demo
```

打开 [交互预览](http://127.0.0.1:4173/) 可操作工具栏弹窗、网页悬浮菜单及服务商和模型设置。预览使用示例 API 配置和译文。

## 构建与安装

```sh
npm ci
npm run build
```

| 浏览器 | 开发安装 |
| --- | --- |
| Chrome | 在 `chrome://extensions` 打开开发者模式，选择「加载已解压的扩展程序」，选中 `dist/chrome`。 |
| Firefox | 在 `about:debugging#/runtime/this-firefox` 选择「临时载入附加组件」，选中 `dist/firefox/manifest.json`。 |
| Safari | 支持「添加临时扩展」的版本，可在 Safari → 设置 → 开发者中选中 `dist/safari`。也可用下方 Xcode 流程。 |

在安装扩展前已经打开的网页，需要刷新一次。Safari 需要为扩展允许访问要翻译的网站及模型 API 域名。

### Safari Xcode 流程

```sh
npm run safari
```

打开 `dist/xcode/Obsidian Translate/Obsidian Translate.xcodeproj`，选择 macOS 或 iOS 运行目标。macOS 可按 Apple 文档用本地签名运行，再在 Safari 的扩展设置中启用。iOS 真机安装与商店发行需要相应的签名配置。Xcode 工程引用 `dist/safari`，修改扩展代码后运行 `npm run build` 即可更新资源。

参考 [Apple 临时安装与本地测试](https://developer.apple.com/documentation/safariservices/building-and-testing-a-safari-web-extension) 和 [Safari 打包文档](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)。

## 配置翻译服务

1. 从工具栏或网页右下角的浮窗展开高级面板，打开「高级设置 → 服务商与模型」。初次使用预设 OpenAI 和 GPT-4.1 mini，填写自己的 API Key 后即可试译。
2. 添加其他服务商时，选择所用协议并填写 Base URL、API Key 和每秒最大请求数。无鉴权的本地服务可将 API Key 留空。
3. 通过「从 API 导入」读取模型列表，或手动填写模型 ID。同一服务商的模型共用连接设置。工具栏和网页浮窗都可以切换模型。

| 协议 | 官方 Base URL | 生成接口 |
| --- | --- | --- |
| OpenAI 兼容 | `https://api.openai.com/v1` | `POST /chat/completions` |
| OpenAI Responses | `https://api.openai.com/v1` | `POST /responses` |
| Anthropic Messages | `https://api.anthropic.com/v1` | `POST /messages` |

使用自定义服务时，按服务商要求填写版本路径，例如 `https://example.com/api/v1`。模型发现使用 `GET /models`，仅提供生成接口的上游可手动添加模型。

## 翻译网页

- 简洁浮窗只放「翻译」「还原」、模型和目标语言。展开侧边面板可修改源语言、显示方式、范围、网站规则和双语字幕，也可以打开文本翻译、文件翻译或高级设置。
- 默认翻译正文并仅显示译文。支持整页、双语对照、调整原文和译文的顺序及译文样式。动态加载的文段会继续进入队列，优先处理视口附近的内容。
- 从工具栏、网页浮窗、网页右键菜单或 `Option / Alt + Shift + T` 翻译。选中文字可以划词翻译，鼠标指向文段时按 `Shift` 可以单独翻译。
- 在输入框中按 `Option / Alt + Shift + I` 翻译选区或当前内容，也可在设置中开启连按三次空格。内容开头加 `/ja` 或 `/en` 可指定语言，使用 `//` 可只翻译标记之后的文字。
- 可以按网站或网页源语言启用自动翻译。网站规则优先，停用网站后可从工具栏恢复。启用双语字幕后，在 YouTube 或使用标准 HTML 字幕轨的播放器中打开原字幕。
- 高级设置支持系统提示词、翻译提示词、单段用户提示词、多段落系统及用户提示词、字幕提示词和术语对照。用户提示词里的 `{{text}}` 是待翻译内容，`{{from}}`、`{{to}}` 和 `{{title}}` 可插入翻译上下文。
- 请求按服务商独立限速，本地缓存按连接、模型、语言和提示词匹配。可查看、关闭或清除缓存。

文件翻译支持 TXT、Markdown、SRT 和 WebVTT。SRT 与 WebVTT 保留字幕时间轴。

扩展在浏览器后台直接请求所选服务商。翻译时，目标语言、提示词及待译文本会发送到该服务商。连接设置和译文缓存均保存在当前浏览器。

## 发版

本地打包需要 Node.js 22 和 `zip`。

```sh
npm ci
npm run package
```

Chrome、Firefox、Safari 的开发安装包输出到 `dist/release/v<版本>/`。ZIP 的根目录包含 `manifest.json`。Chrome 解压后加载目录，Firefox 可临时载入，Safari 可选取 ZIP 或解压后的目录进行临时开发安装。浏览器商店各自的签名和审核是独立流程。

版本号取自 `package.json`。日常改动正常提交，发版时更新版本、打包检查、提交版本改动，再创建同名 Git 标签。例如：

```sh
npm version 0.0.1 --no-git-tag-version
npm run package
git add package.json package-lock.json
git commit -m "Release v0.0.1"
git tag -a v0.0.1 -m "Obsidian Translate 0.0.1"
git push origin main
git push origin v0.0.1
```

推送标签后，唯一的发版工作流会核对版本、构建 ZIP，并将三个安装包附在同名 GitHub Release 下。
