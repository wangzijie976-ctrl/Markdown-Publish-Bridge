import { randomUUID } from 'node:crypto';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { images } from './markdown';
import type { Asset } from './assets';

export interface Selectors { title: string; body: string; imageInput: string; imageButton: string; markdownInput?: string }
export const DEFAULT_SELECTORS: Selectors = {
  title: 'input.article-bar__title', body: '.editor__inner',
  imageInput: '[role="dialog"][aria-label="Insert image"] input[type="file"]',
  imageButton: 'button[data-title^="图片"]', markdownInput: '#import-markdown-file-input'
};
const NEW_ARTICLE = 'https://editor.csdn.net/md/';
export class CsdnBrowser {
  private context?: BrowserContext;
  private page?: Page;
  private ownedBody?: string;
  private ownedTitle?: string;
  constructor(private profile: string, private channel: string, private selectors: Selectors) {}
  async open(): Promise<void> {
    this.context = await chromium.launchPersistentContext(this.profile, { channel: this.channel, headless: false, chromiumSandbox: true });
    this.context.on('close', () => { this.context = undefined; this.page = undefined; });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(15000);
    await this.page.goto(NEW_ARTICLE, { waitUntil: 'domcontentloaded' });
    await Promise.race([
      this.page.waitForURL(url => url.hostname === 'passport.csdn.net'),
      this.page.locator(this.selectors.markdownInput || DEFAULT_SELECTORS.markdownInput!).waitFor({ state: 'attached' })
    ]);
  }
  needsLogin(): boolean {
    return !!this.page && new URL(this.page.url()).hostname === 'passport.csdn.net';
  }
  async createBlankArticle(): Promise<void> {
    if (!this.context) throw new Error('浏览器已关闭，请重新运行命令');
    // Never use the login tab or any draft selected by the user as the write target.
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(15000);
    await this.page.goto(NEW_ARTICLE, { waitUntil: 'domcontentloaded' });
    const page = this.editor();
    const input = page.locator(this.selectors.markdownInput || DEFAULT_SELECTORS.markdownInput!);
    await input.waitFor({ state: 'attached' });
    if (new URL(page.url()).searchParams.has('articleId')) throw new Error('CSDN 打开了已有草稿，已停止写入');
    const title = page.locator(this.selectors.title);
    const previousTitle = (await title.inputValue()).trim();
    const previousBody = (await this.read()).trim();
    const welcome = previousBody.startsWith('@[TOC](这里写自定义目录标题)') &&
      previousBody.includes('# 欢迎使用Markdown编辑器') && previousBody.includes('这是你第一次使用 **Markdown编辑器** 所展示的欢迎页');
    if (new URL(page.url()).searchParams.has('articleId') || (previousTitle && previousTitle !== '【无标题】') || (previousBody && !welcome)) {
      throw new Error('CSDN 在新标签页恢复了已有内容，已停止以保护草稿');
    }
    // An invisible, unique Markdown comment verifies that the official importer
    // created this task's editor even when the old document was already blank.
    await this.importMarkdown(`<!-- md-to-csdn:${randomUUID()} -->\n`, 'Markdown-to-CSDN-上传准备.md');
    this.ownedBody = await this.read();
    this.ownedTitle = await title.inputValue();
  }
  private editor() {
    if (!this.page || this.page.isClosed()) throw new Error('浏览器已关闭，请重新运行命令');
    if (new URL(this.page.url()).origin !== 'https://editor.csdn.net') throw new Error('请完成 CSDN 登录并进入 Markdown 编辑器');
    return this.page;
  }
  private async read(): Promise<string> {
    const el = this.editor().locator(this.selectors.body);
    if (await el.count() !== 1) throw new Error('无法唯一定位 Markdown 编辑器，请检查 bodySelector 设置');
    return el.evaluate((node: any) => 'value' in node ? node.value : node.tagName === 'PRE' ? node.textContent || '' : node.innerText);
  }
  async assertBlank() {
    const title = this.editor().locator(this.selectors.title);
    if (await title.count() !== 1) throw new Error('无法唯一定位标题，请检查 titleSelector 设置');
    const titleText = (await title.inputValue()).trim();
    if ((titleText && titleText !== '【无标题】') || (await this.read()).trim()) throw new Error('编辑器包含已有内容。请新建空白文章；若是 CSDN 自带欢迎示例，请手动清空示例后再继续。插件不会覆盖已有草稿。');
  }
  private async importMarkdown(markdown: string, filename = 'Markdown-to-CSDN.md') {
    const input = this.editor().locator(this.selectors.markdownInput || DEFAULT_SELECTORS.markdownInput!);
    if (await input.count() !== 1) throw new Error('无法定位 Markdown 导入控件，停止写入');
    await input.setInputFiles({ name: filename, mimeType: 'text/markdown', buffer: Buffer.from(markdown, 'utf8') });
    const normalize = (s: string) => s.replace(/\r\n/g, '\n').replace(/\n$/, '');
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (normalize(await this.read()) === normalize(markdown)) return;
      await this.editor().waitForTimeout(200);
    }
    throw new Error('导入后正文校验失败，停止后续操作；转换结果已保留在 VS Code 中');
  }
  private async assertOwned() {
    if (this.ownedBody === undefined) { await this.assertBlank(); return; }
    if (await this.read() !== this.ownedBody || await this.editor().locator(this.selectors.title).inputValue() !== this.ownedTitle) {
      throw new Error('检测到测试上传区域被其他操作修改，停止以保护内容');
    }
  }
  async upload(asset: Asset): Promise<string> {
    if (asset.buffer.length > 5 * 1024 * 1024) throw new Error('CSDN 单张图片最大支持 5 MB');
    const page = this.editor();
    await this.assertOwned();
    const before = await this.read();
    const titleBefore = await page.locator(this.selectors.title).inputValue();
    const previous = new Set(images(before).map(i => i.url));
    await page.locator(this.selectors.body).click();
    await page.keyboard.press('ControlOrMeta+End');
    if (!before.endsWith('\n\n')) await page.keyboard.press('Enter');
    if (this.selectors.imageButton) await page.locator(this.selectors.imageButton).click();
    const input = page.locator(this.selectors.imageInput);
    if (await input.count() !== 1) throw new Error('无法唯一定位图片上传控件。请打开编辑器图片上传面板，或调整 imageInputSelector / imageButtonSelector');
    await input.setInputFiles(asset);
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const current = await this.read();
      const candidates = images(current).map(i => i.url).filter(url => {
        try { const u = new URL(url); return u.protocol === 'https:' && /(^|\.)csdnimg\.cn$/.test(u.hostname) && !previous.has(url); } catch { return false; }
      });
      if (candidates.length === 1) {
        // Leave uploaded placeholders in this task's scratch editor. Import the final
        // document only once; importing after every image creates needless drafts.
        this.ownedBody = current;
        this.ownedTitle = titleBefore;
        return candidates[0];
      }
      if (candidates.length > 1) throw new Error('检测到多个新图片链接，停止以避免替换错误');
      await page.waitForTimeout(300);
    }
    throw new Error('45 秒内未检测到 CSDN 图片链接。请检查上传面板、网络和页面选择器；不会填入最终正文');
  }
  async fillArticle(title: string, markdown: string) {
    await this.assertOwned();
    await this.importMarkdown(markdown);
    const input = this.editor().locator(this.selectors.title);
    if (!await input.isVisible()) await this.editor().locator('.article-bar__title-display').click();
    await input.fill(title);
    await input.press('Tab');
    if (await input.inputValue() !== title) throw new Error('标题写入校验失败');
    this.ownedBody = undefined;
    this.ownedTitle = undefined;
  }
  async close() { await this.context?.close(); }
}
