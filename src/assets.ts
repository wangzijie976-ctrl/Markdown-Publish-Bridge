import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX = 5 * 1024 * 1024;
export interface Asset { name: string; mimeType: string; buffer: Buffer }
function asset(buffer: Buffer): Asset {
  if (buffer.length > MAX) throw new Error('图片超过 CSDN 的 5 MB 限制');
  let kind: string;
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) kind = 'png';
  else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) kind = 'jpeg';
  else if (/^GIF8[79]a/.test(buffer.subarray(0, 6).toString())) kind = 'gif';
  else if (buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP') kind = 'webp';
  else throw new Error('仅支持 PNG/JPEG/GIF/WebP 图片，请先转换 SVG 等格式');
  return { name: `image.${kind}`, mimeType: `image/${kind}`, buffer };
}
export function publicAddress(ip: string): boolean {
  if (isIP(ip) !== 4) return false; // IPv6 默认拒绝，避免映射地址和本地网段绕过。
  const [a,b] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
}
export async function loadAsset(url: string, documentPath: string, root: string): Promise<Asset> {
  if (url.startsWith('data:')) {
    const match = /^data:image\/(?:png|jpeg|gif|webp);base64,([a-zA-Z0-9+/=\s]+)$/.exec(url);
    if (!match || match[1].length > MAX * 1.4) throw new Error('不支持或过大的 data 图片');
    return asset(Buffer.from(match[1], 'base64'));
  }
  if (/^https?:\/\//i.test(url)) {
    let target = new URL(url);
    for (let hops = 0; hops < 5; hops++) {
      if (target.protocol !== 'https:' || target.username || target.password) throw new Error('外链图片必须使用无凭证的 HTTPS URL');
      const addresses = await lookup(target.hostname, { all: true, family: 4 });
      if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('不允许下载本地、私有网络或 IPv6 图片地址');
      // Pin the validated address to avoid DNS rebinding between validation and connection.
      const { request } = await import('node:https');
      const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
        const req = request(target, { lookup: ((_host: string, options: any, cb: any) => options.all ? cb(null, [addresses[0]]) : cb(null, addresses[0].address, 4)) as any,
          signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Markdown-to-CSDN/0.1' } }, resolve);
        req.on('error', reject); req.end();
      });
      if ([301,302,303,307,308].includes(response.statusCode!)) {
        response.resume(); if (!response.headers.location) throw new Error('图片重定向缺少目标');
        target = new URL(response.headers.location, target); continue;
      }
      if (response.statusCode !== 200) { response.resume(); throw new Error(`图片下载失败 HTTP ${response.statusCode}`); }
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of response) { length += chunk.length; if (length > MAX) { response.destroy(); throw new Error('图片超过 CSDN 的 5 MB 限制'); } chunks.push(chunk); }
      return asset(Buffer.concat(chunks));
    }
    throw new Error('图片重定向次数过多');
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[a-z]:[\\/]/i.test(url) && !url.startsWith('file:')) throw new Error('不支持的图片协议');
  const filename = await realpath(url.startsWith('file:') ? fileURLToPath(url) : path.resolve(path.dirname(documentPath), decodeURIComponent(url)));
  const relative = path.relative(await realpath(root), filename);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('图片位于工作区之外，请先移入工作区');
  if ((await stat(filename)).size > MAX) throw new Error('图片超过 CSDN 的 5 MB 限制');
  return asset(await readFile(filename));
}
