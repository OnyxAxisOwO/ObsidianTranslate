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

1. 在扩展设置中添加服务商，选择所用协议并输入 Base URL、API Key 和每秒最大请求数。无鉴权的本地服务可将 API Key 留空。
2. 通过「从 API 导入」读取模型列表，或手动填写模型 ID。服务商下的所有模型共用连接设置。
3. 对模型点击「试译」，成功后设为默认模型。工具栏还可以快速切换目标语言和模型。

| 协议 | 官方 Base URL | 生成接口 |
| --- | --- | --- |
| OpenAI 兼容 | `https://api.openai.com/v1` | `POST /chat/completions` |
| OpenAI Responses | `https://api.openai.com/v1` | `POST /responses` |
| Anthropic Messages | `https://api.anthropic.com/v1` | `POST /messages` |

自定义服务应使用服务商给出的版本路径，例如 `https://example.com/api/v1`。模型发现使用对应服务的 `GET /models`，也可以接入只实现生成接口的服务。

## 翻译功能

- 翻译正文或整页，默认仅显示译文，可切换为双语对照或原文。网页动态加载的新文段会继续进入翻译队列。
- 从工具栏、网页悬浮窗、右键菜单或 `Option / Alt + Shift + T` 发起翻译。选中文字可点划词按钮。在文段上悬停并按 `Shift` 做局部翻译。在输入框中按 `Option / Alt + Shift + I` 翻译选区或当前内容。
- 按网站设置总是翻译或永不翻译。开启双语视频字幕后，YouTube 或使用标准 HTML 字幕轨的网页播放器可以显示译文，需要先在播放器里打开原字幕。
- 在设置中翻译 TXT、Markdown、SRT 和 WebVTT 文件。字幕翻译保留序号和时间轴，可导出双语文件或仅译文。
- 自定义每次请求的文段数、字符上限和翻译提示词。网页优先翻译视口附近的文段，每个服务商独立限速。
- 本地缓存按连接、模型、目标语言、提示词和源文段匹配，可查看缓存数量、关闭缓存或清除全部译文。

扩展在浏览器后台直接请求所选服务商。翻译时，目标语言、提示词及待译文本会发送到该服务商。连接设置和译文缓存均保存在当前浏览器。
