/* global URL */
// 本番ビルド（dist）を dist/_headers のヘッダー付きで配信する小さなサーバー（8-1。scripts/ui-audit-release.js が使う）。
// Cloudflare Pages の _headers の形式（パスの行 + 字下げしたヘッダーの行。末尾 * は前方一致）を読む
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** dist/_headers（Cloudflare Pages の形式: パスの行 + 字下げしたヘッダーの行）を読む */
export function parseHeaders(text) {
  const rules = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push({ path: line.trim(), headers: {} });
    else {
      const m = /^\s+([^:]+):\s*(.*)$/.exec(line);
      const rule = rules[rules.length - 1];
      if (m && rule) rule.headers[m[1]] = m[2];
    }
  }
  return rules;
}

function headersFor(rules, path) {
  const out = {};
  for (const r of rules) {
    const hit = r.path.endsWith('*') ? path.startsWith(r.path.slice(0, -1)) : path === r.path;
    if (hit) Object.assign(out, r.headers);
  }
  return out;
}

/** dist を _headers 付きで配信する。無いファイルは 404 */
export function serveDist(dir, port) {
  const rules = parseHeaders(readFileSync(join(dir, '_headers'), 'utf8'));
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const file = normalize(join(dir, path.endsWith('/') ? `${path}index.html` : path));
    if (!file.startsWith(normalize(dir)) || !existsSync(file) || path === '/_headers') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      ...headersFor(rules, path.endsWith('/') ? `${path}index.html` : path),
    });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
