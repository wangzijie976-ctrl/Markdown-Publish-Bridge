# 发布 Markdown Publish Bridge

0.4.0 包含 CSDN 和知乎。普通本地打包使用 local-dev.md-to-csdn 作为测试标识，商店发布需要自己的 Marketplace Publisher ID。

## 创建发布者

打开 [Marketplace 发布者管理页面](https://marketplace.visualstudio.com/manage)，用自己的 Microsoft 账号登录并创建 Publisher。记下 **Publisher ID**，它可能与展示名称不同。

## 生成正式包

在项目目录运行以下命令，将最后一行的 ID 替换成真实 Publisher ID。

```powershell
Set-Location 'Markdown-Publish-Bridge'
npm ci
npm run check
npm test
npm run test:browser
npm run package:marketplace -- --publisher 你的PublisherID
```

正式包输出到 release/markdown-publish-bridge-0.4.0.vsix。脚本在临时目录中设置真实 publisher 和正式扩展名 markdown-publish-bridge，根目录的本地开发身份保持可继续测试。正式扩展标识为 你的PublisherID.markdown-publish-bridge。

脚本会检查 Publisher ID 形式，并拒绝 local-dev。ID 是否属于当前账号、扩展标识是否可用，以 Marketplace 上传校验为准。

## 上传

回到自己的 Publisher 管理页面，选择 **New extension → Visual Studio Code**，上传 release 目录刚生成的正式 VSIX，按页面要求提交。Marketplace 支持这种网页手动上传方式。

正式发布者及扩展标识与本地测试版不同，VS Code 会将它们视为两个扩展。安装商店版后可卸载本地测试版。

更新时修改项目 version，重新测试和打包，然后在同一个商店条目上传新版本。

发布说明、图标、MIT 许可证和隐私说明均已包含在包中。可在商店页面使用 README 作为功能介绍。

官方步骤见 [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)。
