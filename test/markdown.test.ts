import { test } from 'node:test';
import assert from 'node:assert/strict';
import { images, migrate } from '../src/markdown';
import { publicAddress, loadAsset } from '../src/assets';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('正文、代码块和行内代码保持原样，重复图片只上传一次', async () => {
  const source = '# 标题\n\n中文正文\n![a](./a.png)\n![b](./a.png)\n```md\n![example](fake.png)\n```\n`![x](fake2.png)`';
  let calls = 0;
  const out = await migrate(source, async () => { calls++; return 'https://i.csdnimg.cn/a.png'; });
  assert.equal(calls, 1); assert.ok(out.includes('```md\n![example](fake.png)\n```')); assert.ok(out.includes('中文正文')); assert.equal(images(out).length, 2);
});
test('引用式图片不改变共享同一定义的普通链接', async () => {
  const result = await migrate('![图片][x]\n[下载][x]\n\n[x]: a.png "标题"', async () => 'https://i.csdnimg.cn/a.png');
  assert.ok(result.includes('![图片](https://i.csdnimg.cn/a.png "标题")')); assert.ok(result.includes('[下载][x]')); assert.ok(result.includes('[x]: a.png'));
});
test('HTML 图片支持单引号、实体和 src 中空格，保留其他属性', async () => {
  const source = '<img alt="说明" src=\'a b.png?x=1&amp;y=2\' width="300">';
  assert.equal(images(source)[0].url, 'a b.png?x=1&y=2');
  assert.equal(await migrate(source, async () => 'https://i.csdnimg.cn/a.png?a=1&b=2'), '<img alt="说明" src="https://i.csdnimg.cn/a.png?a=1&amp;b=2" width="300">');
});
test('上传失败拒绝整个转换，不返回部分正文', async () => {
  let calls = 0;
  await assert.rejects(migrate('![a](a.png) ![b](b.png)', async () => { if (++calls === 2) throw new Error('上传失败'); return 'https://i.csdnimg.cn/a'; }), /上传失败/);
});
test('拒绝危险的上传结果与未支持的 srcset', async () => {
  await assert.rejects(migrate('![a](a.png)', async () => 'javascript:alert(1)'));
  assert.throws(() => images('<img src="a.png" srcset="b.png 2x">'), /srcset/);
});
test('解析含空格的路径及嵌套括号', () => {
  assert.deepEqual(images('![a](<a b.png>) ![b](a(b).png)').map(i => i.url), ['a b.png', 'a(b).png']);
});
test('CSDN 链接不使用尖括号，URL 括号编码后可正确解析', async () => {
  const result = await migrate('![测试](a.png)', async () => 'https://i-blog.csdnimg.cn/a(b).png#pic_center');
  assert.equal(result, '![测试](https://i-blog.csdnimg.cn/a%28b%29.png#pic_center)');
  assert.equal(images(result).length, 1);
});
test('私网、回环、映射 IPv6 地址被拒绝', () => {
  for (const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','::ffff:127.0.0.1','100.64.0.1']) assert.equal(publicAddress(ip), false);
  assert.equal(publicAddress('8.8.8.8'), true);
});
test('读取工作区图片，拒绝目录外文件和伪装图片', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'md-csdn-'));
  try {
    await writeFile(path.join(dir, 'a.png'), Buffer.from([137,80,78,71,13,10,26,10]));
    assert.equal((await loadAsset('a.png', path.join(dir, 'doc.md'), dir)).mimeType, 'image/png');
    await writeFile(path.join(dir, 'bad.png'), 'not an image');
    await assert.rejects(loadAsset('bad.png', path.join(dir, 'doc.md'), dir), /仅支持/);
    await mkdir(path.join(dir, 'nested'));
    await assert.rejects(loadAsset(path.join(dir, 'a.png'), path.join(dir, 'doc.md'), path.join(dir, 'nested')), /工作区之外/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
