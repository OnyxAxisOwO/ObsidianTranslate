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

1. 点击工具栏或网页右下角浮窗中的「模型设置」，打开「服务商与模型」。该页面也位于设置主导航首项。初次使用预设 OpenAI 和 GPT-4.1 mini，填写自己的 API Key 后即可试译。
2. 添加其他服务商时，选择所用协议并填写 Base URL、API Key 和每秒最大请求数。请求速率支持任意正数，包括小数。无鉴权的本地服务可将 API Key 留空。
3. 通过「从 API 导入」读取模型列表，或手动填写模型 ID。同一服务商的模型共用连接设置。工具栏和网页浮窗都可以切换模型。
4. 编辑模型时可填写「额外请求 JSON」。例如，支持思考参数的 OpenAI Chat Completions 模型可使用 `{"reasoning_effort":"low"}`，Responses 模型可使用 `{"reasoning":{"effort":"low"}}`。Anthropic 或其他兼容服务可填写其支持的 `thinking`、`temperature`、输出长度等参数。保存后会合并进该模型的试译和翻译请求。

请求参数需填写 JSON 对象。模型名、待译文本和流式开关由扩展生成。不同服务商、模型和协议接受的参数及取值以对应接口为准。

| 协议 | 官方 Base URL | 生成接口 |
| --- | --- | --- |
| OpenAI 兼容 | `https://api.openai.com/v1` | `POST /chat/completions` |
| OpenAI Responses | `https://api.openai.com/v1` | `POST /responses` |
| Anthropic Messages | `https://api.anthropic.com/v1` | `POST /messages` |

使用自定义服务时，按服务商要求填写版本路径，例如 `https://example.com/api/v1`。模型发现使用 `GET /models`，仅提供生成接口的上游可手动添加模型。

还可以选择 DeepL、Google Cloud Translation 或 LibreTranslate。DeepL 默认连接 API Free，API Pro 可改用 `https://api.deepl.com/v2`。Google Cloud Translation 需要已启用该 API 的项目密钥。LibreTranslate 可连接自行部署的端点。机器翻译引擎使用各自的翻译接口，AI 提示词和逐模型请求参数仅适用于大语言模型。

在「高级设置 → 配置导入与导出」可下载 JSON 备份，并在另一个浏览器中恢复服务商、模型、API 密钥、提示词、站点规则与偏好。

## 翻译网页

- 简洁浮窗只放「翻译」「还原」、模型和目标语言。展开侧边面板可修改源语言、显示方式、范围、网站规则和双语字幕，也可以打开文本翻译、文件翻译或高级设置。
- 侧边小悬浮球闲置时半透明，靠近后显现。单击翻译或还原，下方的小设置按钮打开菜单。在「悬浮窗」设置中可调整停靠侧边、垂直位置和透明度，或管理隐藏的网站。隐藏悬浮窗后仍可从工具栏和快捷键翻译。
- 默认翻译正文并仅显示译文。支持整页、双语对照、调整原文和译文的顺序及译文样式。动态加载的文段会继续进入队列，优先处理视口附近的内容。
- 首段先单独请求，后续段落继续批量翻译。缓存命中的段落可立即显示，后续的新译文完成后继续补入。
- 等待译文时，段落末尾会显示转圈。可在「网页翻译 → 阅读 → 翻译中提示」切换为三点动画、自定义文字，或关闭提示。
- 从工具栏、网页浮窗、网页右键菜单或 `Option / Alt + Shift + T` 翻译。选中文字可以划词翻译，鼠标指向文段时按 `Shift` 可以单独翻译。
- 在输入框中按 `Option / Alt + Shift + I` 翻译选区或当前内容，也可在设置中开启连按三次空格。内容开头加 `/ja` 或 `/en` 可指定语言，使用 `//` 可只翻译标记之后的文字。
- 可以按网站或网页源语言启用自动翻译。网站规则优先，停用网站后可从工具栏恢复。启用双语字幕后，在 YouTube 或使用标准 HTML 字幕轨的播放器中打开原字幕。
- 「高级设置 → 网站与语言」支持按域名和路径配置翻译方式，例如 `*.example.com/docs/*`。可指定引擎、源语言、目标语言、范围、双语显示和字幕开关，并用 CSS 选择器指定正文或排除区域。多条匹配的规则按具体程度继承和覆盖。在「网页翻译」中启用嵌入框架翻译后，框架跟随主页面翻译或还原，并遵守该框架网址的停用规则。
- 高级设置支持系统提示词、翻译提示词、单段用户提示词、多段落系统及用户提示词、字幕提示词和术语对照。用户提示词里的 `{{text}}` 是待翻译内容，`{{from}}`、`{{to}}` 和 `{{title}}` 可插入翻译上下文。
- 请求按服务商独立限速，本地缓存按连接、模型、语言和提示词匹配。可查看、关闭或清除缓存。

## 文件、图片与字幕

- 纯文本支持 TXT 和 Markdown。字幕支持 SRT、WebVTT、ASS，并保留时间轴。打开网页视频原字幕后，可从高级面板导出双语 SRT。优先导出播放器已加载的标准字幕轨。YouTube 没有可读取的标准轨时，可先开启双语字幕，导出观看期间收集到的字幕。
- 可打开本地 PDF 或输入可直接访问的 HTTP(S) PDF 网址。对含文本层的页面直接取字，对没有文本层的扫描页可选择 OCR。结果按页生成双语或纯译文 HTML，可打开预览后打印或存为 PDF。输出采用重排的文本版式。
- EPUB 翻译章节和目录，DOCX 翻译正文、页眉页脚、脚注和尾注，可重新下载原格式。PDF、EPUB、DOCX 支持不超过 25 MB 的文件，PDF 一次最多 250 页。文本和字幕使用 UTF-8，最大 1 MB。
- PNG、JPEG 和 WebP 支持本地文件及公开图片网址。也可在支持扩展右键菜单的浏览器中右键图片，点「翻译这张图片」。文字在浏览器本地识别，译文按区域叠加，可预览和导出 HTML。英文识别数据已包含在扩展中，其他语言首次使用时下载对应数据。

文档解析使用 PDF.js 与 fflate，图片和扫描页识别使用 Tesseract.js。相应许可证随安装包分发。

扩展在浏览器后台直接请求所选服务商。翻译时，目标语言、提示词及待译文本会发送到该服务商。连接设置和译文缓存均保存在当前浏览器。

## 发版

本地打包需要 Node.js 22.13 或更高版本和 `zip`。

```sh
npm ci
npm run package
```

Chrome、Firefox、Safari 的开发安装包输出到 `dist/release/v<版本>/`。ZIP 的根目录包含 `manifest.json`。Chrome 解压后加载目录，Firefox 可临时载入，Safari 可选取 ZIP 或解压后的目录进行临时开发安装。浏览器商店各自的签名和审核是独立流程。

版本号取自 `package.json`。发版时把完整的更新日志写入 [CHANGELOG.md](CHANGELOG.md)，使用 `## [版本号]` 作为标题，也可在标题后附上发布日期。以上一版实际发布的功能和行为为基准，核对这次用户会看到的变化。同一发版周期内引入又修掉的问题无需单列。

更新版本号和日志后，打包检查，一并提交，再创建同名 Git 标签。下面以 `0.0.2` 为例：

```sh
npm version 0.0.2 --no-git-tag-version
node scripts/release-notes.mjs
npm run package
git add package.json package-lock.json CHANGELOG.md
git commit -m "Release v0.0.2"
git tag -a v0.0.2 -m "Obsidian Translate 0.0.2"
git push origin main
git push origin v0.0.2
```

推送标签后，发版工作流会核对版本和更新日志，构建 ZIP，再用对应版本条目作为 GitHub Release 正文并附上三个安装包。
