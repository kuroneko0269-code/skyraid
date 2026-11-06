// 9-11b: 文言の表を読み込む前に評価された文が残っていないか（M6 の「objectives.wave」の不具合の再発防止）。
// 起動（main.ts）と同じ順番を作る: 表の無い状態で src/data の全モジュールを読み込み（src/missions も）、後から表を読み込んで、
// 定数の木に「表にあるキー」そのものの文字列が残っていないかを調べる（getter は読む時に t() を呼ぶので、正しければ訳になる）
import { describe, expect, it, vi } from 'vitest';
import type { MessageTree } from '../src/core/i18n';
import ja from '../src/data/i18n/ja.json';

const KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;

function isKey(s: string, tree: MessageTree): boolean {
  if (!KEY.test(s)) return false;
  let node: MessageTree | string | readonly string[] | undefined = tree;
  for (const part of s.split('.')) {
    if (node === undefined || typeof node === 'string' || Array.isArray(node)) return false;
    node = (node as MessageTree)[part];
  }
  return node !== undefined;
}

/** 値の木をたどり、表のキーそのものの文字列を集める（getter も読む） */
function rawKeys(root: unknown, tree: MessageTree): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown, path: string, depth: number): void => {
    if (typeof v === 'string') {
      if (isKey(v, tree)) found.push(`${path} = ${v}`);
      return;
    }
    if (v === null || typeof v !== 'object' || seen.has(v) || depth > 12) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) return;
    for (const k of Object.keys(v)) {
      // 「key」「titleKey」のような名前の欄は、わざとキーを持つ（読む側で t() に渡す）
      if (/key$/i.test(k)) continue;
      let child: unknown;
      try {
        child = (v as Record<string, unknown>)[k];
      } catch {
        continue;
      }
      walk(child, `${path}.${k}`, depth + 1);
    }
  };
  walk(root, '', 0);
  return found;
}

describe('文言の表を読む前のモジュールの評価（9-11b）', () => {
  it('src/data・src/missions の定数に、表を読み込む前に決まったキーそのものの文が残っていない', async () => {
    vi.resetModules();
    // 表の無い i18n で全部のデータを読み込む（起動の順番と同じ）
    const loaders = import.meta.glob(['../src/data/**/*.ts', '../src/missions/**/*.ts']);
    const modules: [string, unknown][] = [];
    for (const [path, load] of Object.entries(loaders)) modules.push([path, await load()]);
    const i18n = await import('../src/core/i18n');
    i18n.setMessages('ja', ja);
    const found = modules.flatMap(([path, mod]) => rawKeys(mod, ja).map((s) => `${path}${s}`));
    expect(found).toEqual([]);
  });

  it('M6 の波の目標は「第 1 波」〜「第 3 波」', async () => {
    vi.resetModules();
    const { NIGHT_INTERCEPT_MISSION } = await import('../src/data/missions-late');
    const i18n = await import('../src/core/i18n');
    i18n.setMessages('ja', ja);
    expect(NIGHT_INTERCEPT_MISSION.objectives.map((o) => o.label)).toEqual([
      '第 1 波',
      '第 2 波',
      '第 3 波',
    ]);
  });
});
