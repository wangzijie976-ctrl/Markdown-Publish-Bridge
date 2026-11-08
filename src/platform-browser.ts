import { chromium, type BrowserContext, type Locator, type Page } from 'playwright-core';
import type { Asset } from './assets';
import { platforms, type PlatformId } from './platforms';
import type { ZhihuPart } from './zhihu-content';

const zhihuTitle = 'textarea[placeholder*="标题"]:visible, input[placeholder*="标题"]:visible';
const zhihuBody = '.public-DraftEditor-content[contenteditable="true"]:visible';

type CheckCancelled = () => void;

async function waitFor(check: () => Promise<boolean>, checkCancelled: CheckCancelled, message: string, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    checkCancelled();
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(message);
}

export class PlatformBrowser {
  private context?: BrowserContext;
  private page?: Page;

  constructor(private readonly id: PlatformId, private readonly profile: string, private readonly channel: string) {}

  async open() {
    this.context = await chromium.launchPersistentContext(this.profile, { channel: this.channel, headless: false, chromiumSandbox: true });
    this.page = this.context.pages().find(page => page.url() === 'about:blank') || await this.context.newPage();
    this.page.setDefaultTimeout(12000);
    await this.page.goto(platforms[this.id].url, { waitUntil: 'domcontentloaded' });
  }

  async ready(): Promise<boolean> {
    const page = this.page;
    if (!page || page.isClosed()) return false;
    try {
      await page.locator(zhihuBody).waitFor({ state: 'attached', timeout: 5000 });
      this.editorPage(false);
      return true;
    } catch { return false; }
  }

  async reopenEditor() {
    if (!this.context || !this.page || this.page.isClosed()) throw new Error('创作浏览器已关闭');
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(12000);
    await this.page.goto(platforms[this.id].url, { waitUntil: 'domcontentloaded' });
  }

  async close() { await this.context?.close(); }

  private editorPage(allowZhihuDraft: boolean): Page {
    if (!this.page || this.page.isClosed()) throw new Error('创作浏览器已关闭');
    const expected = new URL(platforms[this.id].url);
    const actual = new URL(this.page.url());
    const pathname = actual.pathname.replace(/\/$/, '');
    const validPath = pathname === expected.pathname || (allowZhihuDraft && /^\/p\/\d+\/edit$/.test(pathname));
    if (actual.origin !== expected.origin || !validPath) throw new Error(`请登录${platforms[this.id].name}并打开新建创作页`);
    return this.page;
  }

  async fillZhihu(title: string, parts: ZhihuPart[], assets: ReadonlyMap<string, Asset>, checkCancelled: CheckCancelled, report: (message: string) => void) {
    const page = this.editorPage(false);
    const heading = page.locator(zhihuTitle);
    const body = page.locator(zhihuBody);
    const blank = await body.evaluate(el => !el.textContent?.trim() && !el.querySelector('img,figure,video,iframe'));
    if (!blank || (await heading.inputValue()).trim()) throw new Error('知乎编辑器已有内容，已停止以保护草稿');
    let snapshot = await this.zhihuSnapshot(body);
    let expectedImages = 0;
    for (const [index, part] of parts.entries()) {
      checkCancelled();
      this.editorPage(true);
      const before = await this.zhihuSnapshot(body);
      if (JSON.stringify(before) !== JSON.stringify(snapshot)) throw new Error('知乎正文在导入过程中被修改，已停止写入');
      report(`正在写入知乎正文 ${index + 1}/${parts.length}`);
      await body.focus();
      await page.keyboard.press('ControlOrMeta+End');
      if (before.needsNewBlock) await page.keyboard.press('Enter');
      if ('image' in part) {
        const asset = assets.get(part.image);
        if (!asset) throw new Error('找不到待上传的图片');
        await this.paste(body, { image: { base64: asset.buffer.toString('base64'), name: asset.name, type: asset.mimeType } });
        expectedImages++;
        await waitFor(async () => {
          const current = await this.zhihuSnapshot(body);
          return current.images.length === expectedImages && current.images.every(url => /^https:\/\/[^/]+\.(zhimg|zhihu)\.com\//i.test(url));
        }, checkCancelled, `知乎第 ${expectedImages} 张图片未确认上传完成`, 45000);
      } else {
        const text = await this.paste(body, { html: part.html });
        await waitFor(async () => {
          const current = await this.zhihuSnapshot(body);
          return current.text === before.text + text && current.images.length === expectedImages;
        }, checkCancelled, `知乎第 ${index + 1} 段正文未完整写入，请检查编辑器`);
      }
      snapshot = await this.zhihuSnapshot(body);
    }
    checkCancelled();
    this.editorPage(true);
    if ((await heading.inputValue()).trim()) throw new Error('知乎标题已被修改，已停止写入');
    await this.fillTitle(heading, title);
  }

  private async zhihuSnapshot(body: Locator) {
    return body.evaluate(el => {
      const last = Array.from(el.querySelectorAll('[data-block="true"]')).at(-1);
      return {
        text: (el.textContent || '').replace(/[\s\u200b\ufeff]/g, ''),
        images: Array.from(el.querySelectorAll('figure img, img[src*="zhimg.com"], img[src^="blob:"]'), img => (img as HTMLImageElement).src),
        needsNewBlock: !!last?.textContent?.trim() || !!last?.querySelector('img')
      };
    });
  }

  private async paste(body: Locator, data: { html?: string; image?: { base64: string; name: string; type: string } }) {
    return body.evaluate((el, payload) => {
      const transfer = new DataTransfer();
      let text = '';
      if (payload.image) {
        const { base64, name, type } = payload.image;
        const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
        transfer.items.add(new File([bytes], name, { type }));
      } else if (payload.html) {
        const parsed = new DOMParser().parseFromString(payload.html, 'text/html');
        text = (parsed.body.textContent || '').replace(/[\s\u200b\ufeff]/g, '');
        transfer.setData('text/html', `${payload.html}<p><br></p>`);
      }
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
      return text;
    }, data);
  }

  private async fillTitle(heading: Locator, title: string) {
    const limit = await heading.getAttribute('maxlength');
    if (limit && Number(limit) > 0 && title.length > Number(limit)) throw new Error(`标题超过网页限制（${limit} 个字符）`);
    await heading.fill(title);
    await heading.blur();
    if (await heading.inputValue() !== title) throw new Error('标题写入校验失败');
  }

}
