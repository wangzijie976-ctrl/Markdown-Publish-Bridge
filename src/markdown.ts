import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { parseFragment } from 'parse5';

export interface ImageRef { url: string; start: number; end: number; render: (url: string) => string }
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
export function images(markdown: string): ImageRef[] {
  const tree = unified().use(remarkParse).parse(markdown);
  const definitions = new Map<string, any>();
  const walk = (node: any, fn: (node: any) => void) => { fn(node); node.children?.forEach((n: any) => walk(n, fn)); };
  walk(tree, n => { if (n.type === 'definition' && !definitions.has(n.identifier)) definitions.set(n.identifier, n); });
  const refs: ImageRef[] = [];
  walk(tree, n => {
    if (n.type === 'image' || n.type === 'imageReference') {
      const source = n.type === 'image' ? n : definitions.get(n.identifier);
      if (!source) throw new Error(`未找到图片引用定义：${n.identifier}`);
      const alt = (n.alt || '').replace(/[\\\[\]]/g, '\\$&');
      const title = source.title ? ` "${source.title.replace(/[\\"]/g, '\\$&')}"` : '';
      refs.push({ url: source.url, start: n.position.start.offset, end: n.position.end.offset,
        // CSDN's paste/import handlers misinterpret angle-bracket destinations.
        render: url => `![${alt}](${url.replace(/\(/g, '%28').replace(/\)/g, '%29')}${title})` });
    }
    if (n.type === 'html') {
      const fragment = parseFragment(n.value, { sourceCodeLocationInfo: true });
      const visit = (el: any) => {
        if (el.tagName === 'img' || el.tagName === 'source') {
          if (el.attrs?.some((a: any) => a.name === 'srcset')) throw new Error('暂不支持 srcset，请改为单个 img src 后重试。');
          const src = el.attrs?.find((a: any) => a.name === 'src');
          const loc = el.sourceCodeLocation?.attrs?.src;
          if (src && loc) refs.push({ url: src.value, start: n.position.start.offset + loc.startOffset,
            end: n.position.start.offset + loc.endOffset, render: url => `src="${escapeAttr(url)}"` });
        }
        el.childNodes?.forEach(visit);
      };
      visit(fragment);
    }
  });
  return refs;
}
export async function migrate(markdown: string, upload: (url: string) => Promise<string>): Promise<string> {
  const refs = images(markdown);
  const urls = new Map<string, string>();
  for (const ref of refs) {
    if (!urls.has(ref.url)) {
      const result = await upload(ref.url);
      const parsed = new URL(result);
      if (parsed.protocol !== 'https:' || /[<>\s]/.test(result)) throw new Error('上传返回了不安全的图片 URL');
      urls.set(ref.url, result);
    }
  }
  return replaceImages(markdown, refs, ref => ref.render(urls.get(ref.url)!));
}

export function replaceImages(markdown: string, refs: ImageRef[], replacement: (ref: ImageRef) => string): string {
  let result = markdown;
  for (const ref of [...refs].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, ref.start) + replacement(ref) + result.slice(ref.end);
  }
  return result;
}
