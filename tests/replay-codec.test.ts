// リプレイ（7-B）の記録の形と容量: チャンネルの差分の往復、ヘッダの確認、1 分あたり 10KB 以下（キーボード・アナログ）
import { describe, expect, it } from 'vitest';
import { createRandom } from '../src/core/random';
import { REPLAY_CONFIG } from '../src/data/replay';
import {
  decodeChannel,
  decodeHeader,
  decodeReplay,
  encodeChannel,
  encodeReplay,
  fromBase64,
  toBase64,
} from '../src/replay/codec';
import { BASE_START, createWorld, record } from './replay-helpers';

describe('チャンネルの差分', () => {
  it('ランダムな値・連続・大きな跳びが往復する', () => {
    const r = createRandom(3);
    const n = 5000;
    const v = new Int16Array(n);
    let x = 0;
    for (let i = 0; i < n; i++) {
      const k = r();
      if (k < 0.5) x += 0;
      else if (k < 0.8) x += Math.round((r() - 0.5) * 14);
      else if (k < 0.95) x = Math.round((r() - 0.5) * 254);
      else x = -1;
      v[i] = x;
    }
    expect([...decodeChannel(encodeChannel(v, n), n)]).toEqual([...v]);
  });

  it('同じ値が続くと 64 ステップで 1 バイト', () => {
    const v = new Int16Array(64 * 10).fill(0);
    expect(encodeChannel(v, v.length).length).toBe(10);
  });

  it('-8〜7 の差は 2 ステップで 1 バイト', () => {
    const v = Int16Array.from({ length: 128 }, (_, i) => (i % 2 === 0 ? 3 : -3));
    expect(encodeChannel(v, v.length).length).toBeLessThanOrEqual(2 * 66);
    expect([...decodeChannel(encodeChannel(v, v.length), v.length)]).toEqual([...v]);
  });
});

describe('記録 1 本', () => {
  it('ヘッダ・入力・コマンドが往復する。壊れたデータ・違うファイルは読まない', () => {
    const { data } = record(createWorld(), BASE_START, {
      seconds: 5,
      commands: [
        { step: 30, kind: 'select', target: 2 },
        { step: 60, kind: 'enemies', enabled: false, difficulty: 'hard', count: 1 },
      ],
    });
    const bytes = encodeReplay(data);
    const back = decodeReplay(bytes);
    expect(back.header).toEqual(data.header);
    expect(back.commands).toEqual(data.commands);
    back.channels.forEach((c, i) => {
      expect([...c]).toEqual([...(data.channels[i] ?? [])]);
    });
    expect(decodeHeader(bytes).seed).toBe(BASE_START.seed);
    expect(decodeReplay(fromBase64(toBase64(bytes))).header.steps).toBe(300);
    expect(() => decodeReplay(bytes.slice(0, bytes.length - 3))).toThrow();
    expect(() => decodeReplay(new TextEncoder().encode('PK\u0003\u0004 not a replay'))).toThrow();
  });
});

describe('容量（1 分あたり 10KB 以下）', () => {
  for (const analog of [false, true]) {
    it(`${analog ? 'アナログのスティック（毎ステップ動く）' : 'キーボード'}で 3 分`, () => {
      const { data } = record(createWorld(), BASE_START, { seconds: 180, analog, pilotSeed: 21 });
      const perMinute = encodeReplay(data).length / 3;
      expect(perMinute).toBeLessThan(REPLAY_CONFIG.bytesPerMinuteMax);
      if (!analog) expect(perMinute).toBeLessThan(3 * 1024);
    }, 60_000);
  }
});
