import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadAsset, type Asset } from './assets';
import { images, replaceImages } from './markdown';

export const platforms = {
  zhihu: { name: '知乎', url: 'https://zhuanlan.zhihu.com/write', filename: 'article.md' },
} as const;

export type PlatformId = keyof typeof platforms;

export async function readArticleAssets(markdown: string, documentPath: string, root: string, checkCancelled: () => void) {
  const assets = new Map<string, Asset>();
  const unique = new Map<string, Asset>();
  let total = 0;
  for (const { url } of images(markdown)) {
    checkCancelled();
    if (assets.has(url)) continue;
    const loaded = await loadAsset(url, documentPath, root);
    const hash = createHash('sha256').update(loaded.buffer).digest('hex');
    let asset = unique.get(hash);
    if (!asset) {
      total += loaded.buffer.length;
      if (total > 100 * 1024 * 1024) throw new Error('文章图片总大小超过 100 MB，请拆分文章');
      asset = { ...loaded, name: `image-${String(unique.size + 1).padStart(2, '0')}${path.extname(loaded.name)}` };
      unique.set(hash, asset);
    }
    assets.set(url, asset);
  }
  checkCancelled();
  return assets;
}

export async function preparePlatform(id: PlatformId, markdown: string, documentPath: string, root: string, destination: string, checkCancelled: () => void) {
  const refs = images(markdown);
  const assets = await readArticleAssets(markdown, documentPath, root, checkCancelled);
  const unique = new Set(assets.values());
  const directory = await mkdtemp(path.join(destination, `${id}-`));
  if (unique.size) await mkdir(path.join(directory, 'images'));
  for (const { name, buffer } of unique) await writeFile(path.join(directory, 'images', name), buffer);
  const content = replaceImages(markdown, refs, ref => ref.render(`./images/${assets.get(ref.url)!.name}`));
  const output = path.join(directory, platforms[id].filename);
  await writeFile(output, content, 'utf8');
  return { directory, output, content, imageCount: unique.size };
}
