<img src="assets/icon.png" alt="Markdown Publish Bridge" width="96" />

# Markdown Publish Bridge

一个 VS Code 扩展，将本地 Markdown 文章和图片导入 **CSDN、知乎**。正文与代码以可复制的文字保留，图片通过平台自己的编辑器上传。

当前版本 **0.4.0**，支持桌面版 VS Code。项目暂未发布到 VS Code 插件市场，可通过源码构建 VSIX 安装。

## 功能

- 自动读取 Markdown 内联图片、引用式图片和 HTML img 标签。
- 读取工作区本地图片，下载可访问的 HTTPS 外链图片，并在上传前校验。
- **CSDN** 自动准备新文章，上传图片、替换链接，再通过 Markdown 导入控件填写正文。
- **知乎** 按原文顺序交替写入富文本和图片，保留图文位置。
- 在编辑页检查正文与图片后，由用户补充分类、标签等信息并发布。
- 知乎提供备用的本地素材导出功能。

## 环境要求

- 桌面版 VS Code 1.95 或更新版本。
- 已安装 Microsoft Edge 或 Google Chrome，默认使用 Edge。
- 从源码构建时需要 Node.js 22 或更新版本和 npm。

当前主要验证环境为 Windows 和 Edge。扩展依赖浏览器与平台网页编辑器，暂不适用于 VS Code 网页版或无桌面的远程环境。

## 构建与安装

```sh
git clone https://github.com/wangzijie976-ctrl/Markdown-Publish-Bridge.git
cd Markdown-Publish-Bridge
npm ci
npm run package
```

构建后会在项目根目录生成 md-to-csdn-0.4.0.vsix。在 VS Code 扩展面板点击右上角的 **… → 从 VSIX 安装**，选择生成的文件。

当前保留内部标识 local-dev.md-to-csdn，以便升级之前的本地测试版。扩展在界面上的名称为 **Markdown Publish Bridge**。

## 使用方法

1. 打开本地 .md 文件，扩展处理当前编辑器中的内容，包括未保存的修改。
2. 在 Markdown 正文区域右键，选择 **Markdown Publish Bridge: 选择发布平台**。
3. 选择 **CSDN** 或 **知乎**。知乎继续选择 **自动上传并填入编辑器**。
4. 确认标题和上传操作。在扩展打开的独立浏览器窗口登录对应平台，并按 VS Code 提示继续。
5. 等待正文和图片写入，检查网页预览，补充发布设置后在网页发布。

也可以按 Ctrl+Shift+P 打开命令面板，搜索 Markdown Publish Bridge。

| 命令 | 功能 |
| --- | --- |
| 选择发布平台 | 选择 CSDN 或知乎 |
| 上传到 CSDN | 直接处理当前 Markdown |
| 检查文章图片 | 统计图片引用和来源 |
| 关闭登录浏览器 | 关闭扩展打开的浏览器会话 |

在设置中搜索 mdToCsdn，可通过 mdToCsdn.browserChannel 选择 msedge 或 chrome。其余选择器设置用于适配 CSDN 页面变化。

## 图片和排版

支持 PNG、JPEG、GIF、WebP，单图最多 5 MB，每篇文章去重后图片总大小最多 100 MB。

- 相对图片路径以 Markdown 文件所在目录为基准。
- 本地图片必须处于当前工作区内。未打开工作区时，以 Markdown 所在目录为边界。
- 支持 HTTPS 图片和 base64 data 图片。需要登录或有防盗链的外链可能下载失败，可先保存到工作区。
- HTTP、SVG、srcset、私网及 IPv6 图片地址暂不支持。
- 普通附件、视频和 CSS 背景图不迁移，代码块中的图片语法示例保持原样。

CSDN 导入 Markdown 源文，知乎接收转换后的富文本。表格、公式、复杂 HTML 和代码高亮的最终呈现由平台编辑器决定，请检查预览。

## 登录与数据

登录由用户在独立浏览器窗口完成，登录状态保存在此扩展的 VS Code globalStorage 目录。确认上传后，标题、正文及图片发送给选定平台，网页可能自动保存草稿。

扩展没有自建服务或遥测。详细说明见 [PRIVACY.md](PRIVACY.md)。

## 开发与测试

```sh
npm ci
npm run check
npm test
npm run test:browser
npm run build
```

浏览器测试使用已安装的 Edge，以本地模拟网页验证自动化逻辑。构建后在 VS Code 按 F5，可启动扩展开发窗口。

```text
src/         扩展命令、平台适配器和 Markdown/图片处理
assets/      扩展图标及 SVG 源文件
scripts/     Marketplace 打包脚本
test/        单元测试、浏览器回归与固定测试样例
.vscode/     扩展开发调试配置
```

## 已知限制

扩展依赖平台网页结构，页面改版、网络问题、登录验证可能导致失败。检测到已有草稿或用户中途修改内容时，会停止写入以保护文章。上传失败或取消后，网页可能保留已上传图片及部分草稿。

当前创建新文章，暂不支持修改已发布文章、断点续传或保存文件自动发布。

## 发布与反馈

Marketplace 发布步骤见 [PUBLISHING.md](PUBLISHING.md)，更新记录见 [CHANGELOG.md](CHANGELOG.md)。问题可提交到 [GitHub Issues](https://github.com/wangzijie976-ctrl/Markdown-Publish-Bridge/issues)，请附扩展版本、目标平台和错误信息。

本项目是独立第三方扩展，与 CSDN、知乎没有官方隶属关系。

## 许可证

[MIT](LICENSE)
