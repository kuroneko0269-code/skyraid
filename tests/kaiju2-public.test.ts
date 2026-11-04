// 9-6c: ネフィルガの公開の形（?dev=kaiju2 なし）: フリーフライトに出さず、止めている間は状態の走査に入れない
import { describe, expect, it } from 'vitest';
import { attachKaiju2Dev, parseKaiju2Options } from '../src/missions/kaiju2-dev';
import { BASE_START, createWorld, record } from './replay-helpers';

describe('ネフィルガの公開（9-6c）', () => {
  it('公開の形（?dev=kaiju2 なし）ではフリーフライトに出さず、止めている間は状態の走査に入れない（ほかのモードの記録は今までと同じ）', () => {
    const w = createWorld();
    const dev = attachKaiju2Dev(w.play, parseKaiju2Options(''), {
      ground: w.map.ordnanceGround,
      map: () => w.map.def,
      freeFlight: false,
    });
    const rec = record(w, BASE_START, { seconds: 5, hashes: true });
    expect(dev.freeFlying).toBe(false);
    expect(dev.active).toBe(false);
    const plain = record(createWorld(), BASE_START, { seconds: 5, hashes: true });
    expect(rec.hashes).toEqual(plain.hashes);
  });
});
