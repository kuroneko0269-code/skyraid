// 10-2: レイドの怪獣の共通の土台を入れても、ヴォルガス・ネフィルガのリプレイ（記録の入力・1 秒ごとの丸めたハッシュ）と
// 終わりの状態のハッシュが変わらないこと。期待値は 10-2 の前のコード（1.1.3 の main 887cd31）で同じ手順を回して取った値。
// 10-6: 2 体にも体への衝突（共通の kaiju-ram.ts）を入れたので取り直した（ヴォルガスは衝突の状態が走査に入る分・ネフィルガは衝突と
// ボットの近づきすぎない避け方の分。
// 前の版のリプレイは合わなくなる。互換は考えない指示）
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { simHash } from '../src/replay/sim';
import type { ReplayData } from '../src/replay/types';
import { runKaiju2Bot } from './kaiju2-raid-bots';
import { BASE_START, createWorld, record } from './replay-helpers';

/** 記録の中身（ヘッダの 1 秒ごとのハッシュ・入力の列）とおわりの状態のハッシュを 1 つの指紋に */
function fingerprint(data: ReplayData, finalHash: string): string {
  const h = createHash('sha256');
  h.update((data.header.checkHashes ?? []).join(','));
  h.update(data.header.startHash);
  h.update(String(data.header.steps));
  for (const ch of data.channels) h.update(Buffer.from(ch.buffer, ch.byteOffset, ch.byteLength));
  h.update(JSON.stringify(data.commands));
  h.update(finalHash);
  return h.digest('hex').slice(0, 16);
}

describe('10-2: ヴォルガス・ネフィルガのリプレイと状態のハッシュが 10-2 の前と同じ', () => {
  it('ヴォルガス（ソロのレイド・通常・120 秒）', () => {
    const w = createWorld();
    const { data } = record(
      w,
      { ...BASE_START, mode: 'raid', mapId: 'harbor', raidDifficulty: 'normal' },
      { seconds: 120, pilotSeed: 9 },
    );
    const fp = fingerprint(data, simHash(w));
    expect(fp).toBe(GOLDEN.vorgas);
  }, 60_000);

  it('ネフィルガ（ソロのレイド・熟練のボット・最後まで）', () => {
    const r = runKaiju2Bot({ role: 'skilled', seed: 2, record: true });
    if (!r.data) throw new Error('no data');
    expect(fingerprint(r.data, r.hash)).toBe(GOLDEN.nephirga);
  }, 120_000);
});

const GOLDEN = {
  vorgas: 'c28907a26b5065d8',
  nephirga: '597ed187cc624449',
};
