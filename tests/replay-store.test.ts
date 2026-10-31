// リプレイ（7-B）の保存（IndexedDB。テストは fake-indexeddb）: 自動保存は直近 10 本（古いものから消す）、名前を付けた保存は
// 30 本まで（消さない）、ファイルの読み込み、名前の変更・削除、容量
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { REPLAY_CONFIG } from '../src/data/replay';
import { decodeReplay, encodeReplay } from '../src/replay/codec';
import { cleanName, ReplayStore } from '../src/replay/store';
import type { ReplayHeader } from '../src/replay/types';
import { BASE_START, createWorld, record } from './replay-helpers';

const { data } = record(createWorld(), BASE_START, { seconds: 2 });
const bytes = encodeReplay(data);

function header(i: number): ReplayHeader {
  return { ...data.header, title: `飛行 ${String(i)}` };
}

const open = (): Promise<ReplayStore> => ReplayStore.open(new IDBFactory(), 'test');

describe('IndexedDB の保存', () => {
  it('自動保存は直近 10 本だけ残る（新しい順）', async () => {
    const s = await open();
    for (let i = 0; i < 13; i++) await s.addAuto(header(i), bytes);
    const list = await s.list();
    expect(list).toHaveLength(REPLAY_CONFIG.autoKeep);
    expect(list[0]?.header.title).toBe('飛行 12');
    expect(list[9]?.header.title).toBe('飛行 3');
    const u = await s.usage();
    expect(u.autoCount).toBe(10);
    expect(u.autoBytes).toBe(10 * bytes.length);
    expect(u.savedCount).toBe(0);
  });

  it('名前を付けて保存すると自動の 10 本に数えず消えない。30 本で満杯', async () => {
    const s = await open();
    const ids: number[] = [];
    for (let i = 0; i < 31; i++) ids.push(await s.addAuto(header(i), bytes));
    // 自動は 10 本しか残らないので、足してすぐ保存する
    const s2 = await open();
    let saved = 0;
    for (let i = 0; i < 31; i++) {
      const id = await s2.addAuto(header(100 + i), bytes);
      const r = await s2.save(id, `  ベスト   ${String(i)}  `);
      if (r === 'ok') saved++;
      else expect(r).toBe('full');
    }
    expect(saved).toBe(REPLAY_CONFIG.savedMax);
    const list = await s2.list();
    const savedRows = list.filter((e) => e.kind === 'saved');
    expect(savedRows).toHaveLength(30);
    expect(savedRows.some((e) => e.name === 'ベスト 0')).toBe(true);
    expect(list.filter((e) => e.kind === 'auto').length).toBeLessThanOrEqual(10);
    expect(await s2.save(999999, 'x')).toBe('missing');
    expect(await s2.importSaved(header(0), bytes, 'file')).toBe('full');
    // 1 本消せば入る
    const first = savedRows[0];
    if (!first) throw new Error('none');
    await s2.remove(first.id);
    expect(typeof (await s2.importSaved(header(0), bytes, 'file'))).toBe('number');
    expect(ids).toHaveLength(31);
  });

  it('中身を読み戻せる。名前の変更', async () => {
    const s = await open();
    const id = await s.addAuto(header(1), bytes);
    const got = await s.get(id);
    expect(got?.entry.size).toBe(bytes.length);
    expect(decodeReplay(got?.bytes ?? new Uint8Array()).header.seed).toBe(BASE_START.seed);
    await s.save(id, '初めての空');
    await s.rename(id, '');
    expect((await s.get(id))?.entry.name).toBe('飛行 1');
    expect(await s.get(424242)).toBeNull();
  });

  it('名前は空白を詰め、長さを抑える', () => {
    expect(cleanName('  a   b ', 'x')).toBe('a b');
    expect(cleanName('', 'fallback')).toBe('fallback');
    expect(cleanName('あ'.repeat(100), 'x')).toHaveLength(REPLAY_CONFIG.nameMax);
  });
});
