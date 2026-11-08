import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { preparePlatform } from '../src/platforms';
import { zhihuParts } from '../src/zhihu-content';

test('知乎保留图文顺序，过滤活动 HTML，保留可复制代码和表格', () => {
  const parts = zhihuParts('# 标题\n\n前 ![图][a] 后\n\n<img src="b.png" onerror="evil()">\n\n<script>evil()</script>\n\n```js\nconst x = 1;\n```\n\n|列|\n|--|\n|值|\n\n[a]: a.png');
  assert.deepEqual(parts.filter(part => 'image' in part), [{ image: 'a.png' }, { image: 'b.png' }]);
  const html = parts.flatMap(part => 'html' in part ? [part.html] : []).join('\n');
  assert.match(html, /<pre><code/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /evil\(|md-publisher\.invalid/);
});

test('知乎素材导出保留正文和代码，同图只保存一次', async () => {
  const fixture = path.resolve('test/fixtures');
  const source = path.join(fixture, 'csdn-live-test.md');
  const markdown = await readFile(source, 'utf8');
  const originalImage = await readFile(path.join(fixture, 'csdn-upload-test.png'));
  const destination = await mkdtemp(path.join(tmpdir(), 'md-platforms-'));
  try {
    const zhihu = await preparePlatform('zhihu', markdown, source, fixture, destination, () => {});
    assert.match(await readFile(zhihu.output, 'utf8'), /```python/);
    assert.equal(zhihu.content.match(/\(\.\/images\/image-01\.png\)/g)?.length, 2);

    const directory = path.join(zhihu.directory, 'images');
    assert.equal(zhihu.imageCount, 1);
    assert.deepEqual(await readdir(directory), ['image-01.png']);
    assert.deepEqual(await readFile(path.join(directory, 'image-01.png')), originalImage);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});
