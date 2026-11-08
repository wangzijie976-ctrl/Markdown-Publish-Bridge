import type { Root, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { images, replaceImages } from './markdown';

export type ZhihuPart = { html: string } | { image: string };
type Segment = { nodes: RootContent[] } | { image: string };

export function zhihuParts(markdown: string, platformName = '知乎'): ZhihuPart[] {
  const refs = images(markdown);
  const sources = new Map<string, string>();
  const marked = replaceImages(markdown, refs, ref => {
    const marker = `https://md-publisher.invalid/image/${sources.size}`;
    sources.set(marker, ref.url);
    return ref.render(marker);
  });
  const parser = unified().use(remarkParse).use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize);
  const root = parser.runSync(parser.parse(marked)) as Root;

  function split(children: RootContent[]): Segment[] {
    const result: Segment[] = [];
    const append = (nodes: RootContent[]) => {
      const last = result.at(-1);
      if (last && 'nodes' in last) last.nodes.push(...nodes);
      else result.push({ nodes });
    };
    for (const node of children) {
      if (node.type === 'element' && node.tagName === 'img') {
        const source = sources.get(String(node.properties.src));
        if (!source) throw new Error(`${platformName}正文含有无法匹配的图片，请改为标准 Markdown 图片语法`);
        result.push({ image: source });
      } else if (node.type === 'element' && node.children.length) {
        for (const part of split(node.children)) {
          if ('image' in part) result.push(part);
          else if (part.nodes.some(child => child.type !== 'text' || child.value.trim())) {
            append([{ ...node, children: part.nodes.filter(child => child.type !== 'doctype') }]);
          }
        }
      } else append([node]);
    }
    return result;
  }

  const parts = split(root.children).flatMap((part): ZhihuPart[] => {
    if ('image' in part) return [part];
    const html = toHtml({ type: 'root', children: part.nodes }).trim();
    return html ? [{ html }] : [];
  });
  if (parts.filter(part => 'image' in part).length !== refs.length) throw new Error(`${platformName}正文图片数与源文件不一致，请检查 HTML 图片写法`);
  return parts;
}
