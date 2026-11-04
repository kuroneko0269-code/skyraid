// 9-4: 記録の毎秒の丸めた状態のハッシュ（別の端末の記録のずれを知らせる）と、始めの状態のハッシュの誤報を消す丸め
import { describe, expect, it } from 'vitest';
import { roundedBits } from '../src/replay/state-walk';
import { ReplayPlayer } from '../src/replay/player';
import { replayCheckHashes, type ReplayData } from '../src/replay/types';
import { BASE_START, createWorld, record } from './replay-helpers';

describe('丸めた数のビット列', () => {
  it('最後の桁（1 ulp）の違いでは変わらず、相対 1e-3 の違いでは変わる', () => {
    for (const v of [1234.5678, -0.73, 3.2e5, 0.0042, 610.123456789]) {
      const ulp = Math.abs(v) * Number.EPSILON;
      expect(roundedBits(v + ulp)).toBe(roundedBits(v));
      expect(roundedBits(v - 1e-12 * Math.abs(v))).toBe(roundedBits(v));
      expect(roundedBits(v * 1.001)).not.toBe(roundedBits(v));
    }
    // ごく小さい値は 0（-0 と 0 も同じ）
    expect(roundedBits(1e-15)).toBe(roundedBits(0));
    expect(roundedBits(-0)).toBe(roundedBits(0));
  });
});

function play(data: ReplayData, tweak?: (tick: number, w: ReturnType<typeof createWorld>) => void) {
  const w = createWorld();
  const player = new ReplayPlayer(w, data, w.controls);
  const seen: number[] = [];
  player.onDiverge = (s) => {
    seen.push(s);
  };
  player.begin();
  if (tweak)
    player.onStep = (t) => {
      tweak(t, w);
    };
  while (player.step());
  return { player, seen, w };
}

describe('記録の毎秒のハッシュ', () => {
  const rec = record(createWorld(), BASE_START, { seconds: 6, pilotSeed: 3 });

  it('始めと 1 秒ごと（6 秒の記録で 7 個）', () => {
    expect(replayCheckHashes(rec.data.header)).toHaveLength(7);
  });

  it('同じ端末で再生すると、ずれを知らせない', () => {
    const r = play(rec.data);
    expect(r.player.startMatches).toBe(true);
    expect(r.player.divergedAt).toBeNull();
    expect(r.seen).toEqual([]);
  });

  it('最後の桁の違い（別の端末の模擬）では始めも途中も「違う」と出さない', () => {
    const r = play(rec.data, (t, w) => {
      if (t === 1) {
        const p = w.play.session.aircraft.state.position;
        p.x += p.x * 4e-16;
        p.y += 1e-11;
      }
    });
    expect(r.player.divergedAt).toBeNull();
  });

  it('途中で結果が分かれるほどずれると、最初に違った秒で 1 度だけ知らせる（再生は止めない）', () => {
    const r = play(rec.data, (t, w) => {
      if (t === 150) w.play.session.aircraft.state.position.x += 40;
    });
    expect(r.player.divergedAt).toBe(3);
    expect(r.seen).toEqual([3]);
    expect(r.player.ended).toBe(true);
  });

  it('ハッシュの無い古い記録は今までどおり（始めは startHash で比べ、途中は知らせない）', () => {
    const header = { ...rec.data.header };
    delete (header as { checkHashes?: unknown }).checkHashes;
    const old: ReplayData = { ...rec.data, header };
    const r = play(old, (t, w) => {
      if (t === 150) w.play.session.aircraft.state.position.x += 40;
    });
    expect(r.player.startMatches).toBe(true);
    expect(r.seen).toEqual([]);
  });
});
