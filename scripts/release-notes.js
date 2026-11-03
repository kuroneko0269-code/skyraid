/* global console, process, URL */
// リリースの本文（v1.0.1。.github/workflows/release.yml から呼ぶ）: docs/changelog.md の「## 版（日付）」の項の「- 」の行を Markdown の箇条書きで出す。
// 読み方は src/core/changelog.ts の parseChangelog と同じ（行頭が空白 2 つ以上の行は直前の項目の続き）。
// リポジトリは公開しているので、遊べる URL は載せない（項目に http(s):// があれば外す）。
// 使い方: `node scripts/release-notes.js <版>`（例 1.0.1）。その版の項が無い・空なら終了コード 1
import { readFileSync } from 'node:fs';

const version = process.argv[2] ?? '';
const text = readFileSync(new URL('../docs/changelog.md', import.meta.url), 'utf8');
let found = false;
const items = [];
for (const raw of text.split(/\r?\n/)) {
  const line = raw.trimEnd();
  const heading = /^##\s+(.+)$/.exec(line);
  if (heading) {
    if (found) break;
    // 見出しは「1.0.1（2026-11-03）」。版の後ろが数字・点で続かないこと（1.0.1 で 1.0.10 を拾わない）
    const title = heading[1].trim();
    found = title.startsWith(version) && !/^[\d.]/.test(title.slice(version.length));
    continue;
  }
  if (!found) continue;
  const item = /^[-*]\s+(.+)$/.exec(line);
  if (item) items.push(item[1].trim());
  else if (/^\s{2,}\S/.test(line) && items.length > 0) items.push(`${items.pop()} ${line.trim()}`);
}
const clean = items.map((s) =>
  s
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim(),
);
if (!version || clean.length === 0) {
  console.error(`docs/changelog.md に ${version || '(版なし)'} の項目がありません`);
  process.exit(1);
}
console.log(clean.map((s) => `- ${s}`).join('\n'));
