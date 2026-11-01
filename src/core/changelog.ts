// 更新履歴（7-D。docs/changelog.md）の解析（DOM 非依存）。「## 見出し」ごとに 1 件、その下の「- 」の行が項目。
// 行頭が空白 2 つ以上の続きの行は直前の項目につなげる。ほかの行（# の題・説明）は読み飛ばす
export interface ChangelogEntry {
  readonly title: string;
  readonly items: readonly string[];
}

export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: { title: string; items: string[] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      entries.push({ title: (heading[1] ?? '').trim(), items: [] });
      continue;
    }
    const current = entries[entries.length - 1];
    if (!current) continue;
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item) current.items.push((item[1] ?? '').trim());
    else if (/^\s{2,}\S/.test(line)) {
      const last = current.items.pop();
      if (last !== undefined) current.items.push(`${last} ${line.trim()}`);
    }
  }
  return entries;
}
