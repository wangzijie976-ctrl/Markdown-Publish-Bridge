import * as vscode from 'vscode';
import path from 'node:path';
import { images, migrate } from './markdown';
import type { Asset } from './assets';
import { CsdnBrowser, DEFAULT_SELECTORS } from './csdn';
import { platforms, preparePlatform, readArticleAssets, type PlatformId } from './platforms';
import { PlatformBrowser } from './platform-browser';
import { zhihuParts } from './zhihu-content';

export function activate(context: vscode.ExtensionContext) {
  let browser: CsdnBrowser | undefined;
  const platformBrowsers = new Map<PlatformId, PlatformBrowser>();
  let busy = false;
  const current = () => {
    if (!vscode.workspace.isTrusted) throw new Error('请先信任此工作区');
    const document = vscode.window.activeTextEditor?.document;
    if (!document || document.languageId !== 'markdown' || document.uri.scheme !== 'file') throw new Error('请打开已保存到本地的 Markdown 文件');
    return document;
  };
  const wrap = (fn: () => Promise<void>) => async () => {
    try { await fn(); } catch (e) { void vscode.window.showErrorMessage(`Markdown Publish Bridge：${e instanceof Error ? e.message : String(e)}`); }
  };
  context.subscriptions.push(vscode.commands.registerCommand('mdToCsdn.inspect', wrap(async () => {
    const doc = current(); const refs = images(doc.getText());
    await vscode.window.showInformationMessage(`共 ${refs.length} 处图片引用，${new Set(refs.map(r => r.url)).size} 个不同来源。支持 Markdown 内联/引用式和 HTML img；代码块中的示例不处理。`);
  })));
  context.subscriptions.push(vscode.commands.registerCommand('mdToCsdn.close', wrap(async () => {
    if (busy) throw new Error('正在处理文章，请等待完成');
    await Promise.all([browser?.close(), ...[...platformBrowsers.values()].map(session => session.close())]);
    browser = undefined;
    platformBrowsers.clear();
  })));

  async function fillPlatform(id: PlatformId, doc: vscode.TextDocument, markdown: string) {
    if (busy) throw new Error('已有上传任务正在运行');
    busy = true;
    try {
      const platform = platforms[id];
      const refs = images(markdown);
      const root = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath || path.dirname(doc.uri.fsPath);
      const title = (await vscode.window.showInputBox({
        title: `${platform.name}标题`,
        value: /^#\s+(.+)$/m.exec(markdown)?.[1] || path.basename(doc.uri.fsPath, path.extname(doc.uri.fsPath)),
        validateInput: s => s.trim() ? undefined : '请输入标题'
      }))?.trim();
      if (!title) return;
      const parts = zhihuParts(markdown, platform.name);
      if (!parts.length) throw new Error(`${platform.name}文章正文为空`);
      const confirm = await vscode.window.showWarningMessage(`将把标题、正文及 ${refs.length} 处图片引用对应的图片发送到${platform.name}的新建编辑页。网页可能自动保存草稿，正式发布由你在网页确认。`, { modal: true }, '继续');
      if (confirm !== '继续') return;
      const check = (token: vscode.CancellationToken) => {
        if (token.isCancellationRequested) throw new Error('已取消。网页可能保留本次已写入的内容');
      };
      const assets = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在读取图片', cancellable: true }, (_, token) =>
        readArticleAssets(markdown, doc.uri.fsPath, root, () => check(token)));
      await platformBrowsers.get(id)?.close();
      const config = vscode.workspace.getConfiguration('mdToCsdn');
      const session = new PlatformBrowser(id, path.join(context.globalStorageUri.fsPath, `${id}-browser-profile`), config.get('browserChannel', 'msedge'));
      platformBrowsers.set(id, session);
      await session.open();
      if (!await session.ready()) {
        const ready = await vscode.window.showInformationMessage(`请在打开的浏览器中登录${platform.name}并完成网页验证。`, '登录完成');
        if (!ready) return;
        await session.reopenEditor();
        if (!await session.ready()) throw new Error(`无法进入${platform.name}新建创作页，请检查登录状态或网页提示`);
      }
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在填入${platform.name}创作页`, cancellable: true }, (progress, token) => {
        const report = (message: string) => progress.report({ message });
        return session.fillZhihu(title, parts, assets, () => check(token), report);
      });
      void vscode.window.showInformationMessage('知乎编辑页已填入正文与图片。请在网页检查排版、补充设置后发布。');
    } finally { busy = false; }
  }
  context.subscriptions.push(vscode.commands.registerCommand('mdToCsdn.choosePlatform', wrap(async () => {
    const doc = current();
    const markdown = doc.getText();
    const selected = await vscode.window.showQuickPick([
      { label: 'CSDN', description: '自动上传图片并导入正文', id: 'csdn' as const },
      { label: '知乎', description: '自动上传图片并按原文顺序填入正文', id: 'zhihu' as const }
    ], { placeHolder: '选择发布平台' });
    if (!selected) return;
    if (selected.id === 'csdn') {
      await vscode.commands.executeCommand('mdToCsdn.prepare');
      return;
    }
    const id: PlatformId = selected.id;
    const platform = platforms[id];
    const mode = await vscode.window.showQuickPick(['自动上传并填入编辑器', '仅导出本地素材'], { placeHolder: `选择${platform.name}的处理方式` });
    if (!mode) return;
    if (mode === '自动上传并填入编辑器') {
      await fillPlatform(id, doc, markdown);
      return;
    }
    const directories = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, openLabel: '在此生成发布素材' });
    if (!directories?.length) return;
    const root = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath || path.dirname(doc.uri.fsPath);
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在准备${platform.name}发布素材`, cancellable: true }, (_, token) =>
      preparePlatform(id, markdown, doc.uri.fsPath, root, directories[0].fsPath, () => {
        if (token.isCancellationRequested) throw new Error('已取消');
      })
    );
    await vscode.window.showTextDocument(vscode.Uri.file(result.output), { preview: false });
    const action = await vscode.window.showInformationMessage(`${platform.name}素材已生成（${result.imageCount} 张配图）。请在创作页添加正文和图片。`, '打开创作页', '复制正文', '打开素材文件夹');
    if (action === '打开创作页') await vscode.env.openExternal(vscode.Uri.parse(platform.url));
    if (action === '复制正文') await vscode.env.clipboard.writeText(result.content);
    if (action === '打开素材文件夹') await vscode.env.openExternal(vscode.Uri.file(result.directory));
  })));
  context.subscriptions.push(vscode.commands.registerCommand('mdToCsdn.prepare', wrap(async () => {
    if (busy) throw new Error('已有上传任务正在运行');
    busy = true;
    try {
      const doc = current();
      const markdown = doc.getText();
      const refs = images(markdown);
      const root = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath || path.dirname(doc.uri.fsPath);
      const title = await vscode.window.showInputBox({ title: 'CSDN 文章标题', value: /^#\s+(.+)$/m.exec(markdown)?.[1] || path.basename(doc.uri.fsPath, path.extname(doc.uri.fsPath)), validateInput: s => s.trim().length >= 5 && s.trim().length <= 100 ? undefined : 'CSDN 标题需要 5 到 100 个字符' });
      if (!title) return;
      const confirm = await vscode.window.showWarningMessage(`将下载并上传 ${new Set(refs.map(r => r.url)).size} 个图片来源，并把正文填入 CSDN 编辑器。网页可能自动保存草稿；请勿同时编辑该页面。正式发布需在网页确认。`, { modal: true }, '继续');
      if (confirm !== '继续') return;
      const assets = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '检查并读取图片', cancellable: true }, (_, token) =>
        readArticleAssets(markdown, doc.uri.fsPath, root, () => {
          if (token.isCancellationRequested) throw new Error('已取消');
        }));
      await browser?.close();
      const config = vscode.workspace.getConfiguration('mdToCsdn');
      browser = new CsdnBrowser(path.join(context.globalStorageUri.fsPath, 'csdn-browser-profile'), config.get('browserChannel', 'msedge'), {
        title: config.get('titleSelector', DEFAULT_SELECTORS.title), body: config.get('bodySelector', DEFAULT_SELECTORS.body), imageInput: config.get('imageInputSelector', DEFAULT_SELECTORS.imageInput), imageButton: config.get('imageButtonSelector', DEFAULT_SELECTORS.imageButton), markdownInput: DEFAULT_SELECTORS.markdownInput
      });
      await browser.open();
      if (browser.needsLogin()) {
        const ready = await vscode.window.showInformationMessage('请在打开的浏览器登录 CSDN。登录后插件会自动新建文章。', '登录完成');
        if (!ready) return;
      }
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在打开 CSDN 新文章' }, () => browser!.createBlankArticle());
      const session = browser;
      const uploaded = new Map<Asset, string>();
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '上传图片到 CSDN', cancellable: true }, async (progress, token) => migrate(markdown, async url => {
        if (token.isCancellationRequested) throw new Error('已取消，已上传的图片可能留在 CSDN 草稿中');
        const asset = assets.get(url)!;
        if (!uploaded.has(asset)) {
          progress.report({ message: `已上传 ${uploaded.size} 张，正在处理下一张` });
          uploaded.set(asset, await session.upload(asset));
        }
        if (token.isCancellationRequested) throw new Error('已取消，未填入最终正文');
        return uploaded.get(asset)!;
      }));
      const output = await vscode.workspace.openTextDocument({ language: 'markdown', content: result });
      await vscode.window.showTextDocument(output, { preview: false });
      await session.fillArticle(title.trim(), result);
      await vscode.window.showInformationMessage('正文与图片链接已填入 CSDN 编辑器。请检查预览、标签和分类后在网页发布。原始 Markdown 未修改，转换结果可另存。');
    } finally { busy = false; }
  })));
  context.subscriptions.push({ dispose: () => {
    void browser?.close();
    for (const session of platformBrowsers.values()) void session.close();
  } });
}
