import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { CsdnBrowser, DEFAULT_SELECTORS } from '../src/csdn';
import { PlatformBrowser } from '../src/platform-browser';
import { zhihuParts } from '../src/zhihu-content';
import { readFile } from 'node:fs/promises';

test('浏览器适配器：上传读回、正文一致性及已有草稿保护（模拟网页）', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.context().route('https://editor.csdn.net/**', route => route.fulfill({ contentType: 'text/html', body: `
      <meta charset="utf-8"><div class="article-bar__title-display">【无标题】</div>
      <input class="article-bar__title" value="【无标题】" style="display:none">
      <pre class="editor__inner" contenteditable="true"></pre>
      <input class="cfw-file-input" type="file" accept="image/*">
      <button data-title="图片 – Ctrl+Shift+G">图片</button>
      <div role="dialog" aria-label="Insert image" hidden><input id="image" type="file" accept="image/*"></div>
      <input id="import-markdown-file-input" type="file" accept=".md">
      <script>
      const body = document.querySelector('.editor__inner');
      const title = document.querySelector('.article-bar__title');
      if (location.search.includes('articleId=')) title.value = 'note';
      else body.textContent = '@[TOC](这里写自定义目录标题)\\n\\n# 欢迎使用Markdown编辑器\\n\\n这是你第一次使用 **Markdown编辑器** 所展示的欢迎页';
      let uploads = 0;
      document.querySelector('.cfw-file-input').addEventListener('change', () => { throw new Error('Wrong file input'); });
      document.querySelector('.article-bar__title-display').onclick = () => { title.style.display = ''; };
      document.querySelector('button').onclick = () => { document.querySelector('[role=dialog]').hidden = false; };
      document.querySelector('#image').addEventListener('change', () => {
        body.textContent += '\\n![uploaded](https://i.csdnimg.cn/test' + (++uploads) + '.png)';
        document.querySelector('[role=dialog]').hidden = true;
      });
      document.querySelector('#import-markdown-file-input').addEventListener('change', async e => {
        body.textContent = await e.target.files[0].text(); title.value = 'Markdown-to-CSDN';
      });</script>` }));
    await page.goto('https://editor.csdn.net/md/?articleId=123');
    const adapter = new CsdnBrowser('', 'msedge', DEFAULT_SELECTORS);
    Object.assign(adapter, { page, context: page.context() });
    await assert.rejects(adapter.assertBlank(), /已有内容/);
    await adapter.createBlankArticle();
    const fresh = page.context().pages().find(tab => tab !== page)!;
    assert.match(await fresh.locator('.editor__inner').textContent() ?? '', /^<!-- md-to-csdn:/);
    assert.equal(await page.locator('.article-bar__title').inputValue(), 'note');
    const asset = { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from([137,80,78,71,13,10,26,10]) };
    assert.equal(await adapter.upload(asset), 'https://i.csdnimg.cn/test1.png');
    assert.equal(await adapter.upload(asset), 'https://i.csdnimg.cn/test2.png');
    assert.equal(await fresh.locator('.cfw-file-input').evaluate((e: HTMLInputElement) => e.files!.length), 0);
    const markdown = '# 中文标题\n\n```js\nconst n = 1;\n```\n![图片](https://i.csdnimg.cn/test.png)';
    await adapter.fillArticle('测试标题', markdown);
    assert.equal(await fresh.locator('.editor__inner').textContent(), markdown);
    assert.equal(await fresh.locator('.article-bar__title').inputValue(), '测试标题');
    await assert.rejects(adapter.fillArticle('禁止覆盖', 'new'), /已有内容/);
    assert.equal(await fresh.locator('.editor__inner').textContent(), markdown);
    // A separate job must stop if a user changes the scratch area between uploads.
    const second = new CsdnBrowser('', 'msedge', DEFAULT_SELECTORS);
    Object.assign(second, { context: page.context() });
    await second.createBlankArticle();
    const secondTab = page.context().pages().find(tab => tab !== page && tab !== fresh)!;
    await second.upload(asset);
    await secondTab.locator('.editor__inner').fill('用户编辑的内容');
    await assert.rejects(second.fillArticle('不得覆盖', 'replacement'), /其他操作修改/);
    assert.equal(await secondTab.locator('.editor__inner').textContent(), '用户编辑的内容');
  } finally { await browser.close(); }
});

test('知乎按原文位置上传图片，保留正文排版并保护已有草稿（模拟网页）', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext();
    const png = await readFile('test/fixtures/csdn-upload-test.png');
    const image = { name: 'local.png', mimeType: 'image/png', buffer: png };
    await context.route('https://pic.zhimg.com/**', route => route.fulfill({ contentType: 'image/png', body: png }));
    await context.route('https://zhuanlan.zhihu.com/write', route => route.fulfill({ contentType: 'text/html', body: `
      <meta charset="utf-8"><textarea placeholder="请输入标题"></textarea>
      <div class="public-DraftEditor-content" contenteditable="true"></div>
      <script>
        const editor = document.querySelector('[contenteditable]');
        editor.addEventListener('paste', e => {
          e.preventDefault();
          const file = e.clipboardData.files[0];
          if (file) {
            const figure = document.createElement('figure');
            const img = new Image();
            img.src = URL.createObjectURL(file);
            figure.append(img); editor.append(figure);
            setTimeout(() => { img.src = 'https://pic.zhimg.com/' + file.name; }, 300);
          } else editor.insertAdjacentHTML('beforeend', e.clipboardData.getData('text/html'));
        });
      </script>` }));
    const zhihuPage = await context.newPage();
    await zhihuPage.goto('https://zhuanlan.zhihu.com/write');
    const zhihu = new PlatformBrowser('zhihu', '', 'msedge');
    Object.assign(zhihu, { page: zhihuPage });
    const parts = zhihuParts('## 前言\n\n![图](a.png)\n\n```js\nconst n = 1;\n```\n\n|列|\n|--|\n|值|');
    await zhihu.fillZhihu('知乎标题', parts, new Map([['a.png', image]]), () => {}, () => {});
    const body = zhihuPage.locator('.public-DraftEditor-content');
    assert.deepEqual(await body.locator('h2,figure,pre,table').evaluateAll(nodes => nodes.map(node => node.tagName)), ['H2', 'FIGURE', 'PRE', 'TABLE']);
    assert.equal(await body.locator('img').getAttribute('src'), 'https://pic.zhimg.com/local.png');
    assert.equal(await zhihuPage.locator('textarea').inputValue(), '知乎标题');
    await assert.rejects(zhihu.fillZhihu('覆盖', parts, new Map(), () => {}, () => {}), /已有内容/);

  } finally { await browser.close(); }
});
