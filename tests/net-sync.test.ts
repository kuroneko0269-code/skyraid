import { describe, expect, it } from 'vitest';
import { NET_CONFIG } from '../src/data/net';
import { InputBuffer } from '../src/net/input-buffer';
import { createNetControls, type AircraftStateMsg } from '../src/net/protocol';
import { HostClock, InputSender, SnapshotBuffer, createSampledPose } from '../src/net/sync';

const S = NET_CONFIG.sync;

/** 半径 R・速さ V で水平に円を描く機体の時刻 t の状態 */
const R = 1500;
const V = 250;
function circle(t: number): AircraftStateMsg {
  const w = V / R;
  const a = w * t;
  // 機首は進行方向（-Z が前）。y 軸まわりに a だけ回る
  return {
    id: 1,
    alive: true,
    afterburner: false,
    lastInputSeq: 0,
    position: { x: R * Math.sin(a), y: 800, z: -R * (1 - Math.cos(a)) * -1 },
    orientation: { x: 0, y: Math.sin(-a / 2), z: 0, w: Math.cos(-a / 2) },
    velocity: { x: V * Math.cos(a), y: 0, z: V * Math.sin(a) },
    speed: V,
    throttle: 0.5,
    hp: 100,
  };
}

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

describe('sync: 補間', () => {
  it('15Hz の状態の間をエルミート補間し、旋回中の誤差は 0.5m 未満', () => {
    const buf = new SnapshotBuffer();
    for (let k = 0; k <= 30; k++) buf.push(k / 15, circle(k / 15));
    const out = createSampledPose();
    let worst = 0;
    for (let t = 0.1; t < 1.9; t += 0.01) {
      expect(buf.sample(t, out)).toBe('interpolated');
      worst = Math.max(worst, dist(out.position, circle(t).position));
    }
    expect(worst).toBeLessThan(0.5);
  });

  it('順番が入れ替わって届いた状態も時刻の位置に入る・同じ時刻は 1 つ', () => {
    const buf = new SnapshotBuffer();
    buf.push(0.2, circle(0.2));
    buf.push(0, circle(0));
    buf.push(0.1, circle(0.1));
    buf.push(0.1, circle(0.1));
    expect(buf.size).toBe(3);
    const out = createSampledPose();
    buf.sample(0.05, out);
    expect(dist(out.position, circle(0.05).position)).toBeLessThan(0.1);
  });

  it('途切れたら速度と加速度で外挿し（旋回の弧に沿う）、上限を超えたら止める', () => {
    const buf = new SnapshotBuffer();
    buf.push(0, circle(0));
    buf.push(1 / 15, circle(1 / 15));
    const out = createSampledPose();
    // 1 つ失われたくらい（約 67ms）の外挿は旋回中でも 0.1m 未満
    expect(buf.sample(2 / 15, out)).toBe('extrapolated');
    expect(dist(out.position, circle(2 / 15).position)).toBeLessThan(0.1);
    // 200ms 先でも弧から 0.5m 未満（直線だと約 4m 外れる）
    buf.sample(1 / 15 + 0.2, out);
    expect(dist(out.position, circle(1 / 15 + 0.2).position)).toBeLessThan(0.5);
    // 上限より先は上限の位置で止める
    const edge = createSampledPose();
    buf.sample(1 / 15 + S.maxExtrapolationSeconds, edge);
    expect(buf.sample(1 / 15 + S.maxExtrapolationSeconds + 1, out)).toBe('held');
    expect(dist(out.position, edge.position)).toBeLessThan(1e-9);
  });

  it('状態が 1 つだけなら速度で直線に外挿する', () => {
    const buf = new SnapshotBuffer();
    const last = circle(0);
    buf.push(0, last);
    const out = createSampledPose();
    buf.sample(0.2, out);
    expect(out.position.x).toBeCloseTo(last.position.x + last.velocity.x * 0.2, 6);
  });

  it('保持数を超えたら古いものから捨てる', () => {
    const buf = new SnapshotBuffer();
    for (let k = 0; k < S.bufferSize + 10; k++) buf.push(k, circle(k));
    expect(buf.size).toBe(S.bufferSize);
    expect(buf.newest?.time).toBe(S.bufferSize + 9);
  });
});

describe('sync: ホストの時刻', () => {
  it('表示時刻は最新の受信より 100ms 前（遅延が一定なら）', () => {
    const clock = new HostClock();
    const latency = 0.1;
    // ホストの時刻 h の状態がローカルの h + 5 + latency に届く
    let local = 0;
    for (let k = 0; k < 60; k++) {
      const h = k / 15;
      local = h + 5 + latency;
      clock.observe(h, local);
    }
    const t = clock.renderTime(local);
    expect(t).not.toBeNull();
    expect((59 / 15 - (t ?? 0)) * 1000).toBeCloseTo(S.interpolationDelaySeconds * 1000, 3);
  });

  it('遅れて届いたものに引きずられない（いちばん早く届いたものに合わせる）', () => {
    const clock = new HostClock();
    for (let k = 0; k < 30; k++) clock.observe(k / 15, k / 15 + 1 + (k % 3 === 1 ? 0.08 : 0));
    const now = clock.hostNow(29 / 15 + 1);
    expect(now).toBeCloseTo(29 / 15, 6);
  });
});

describe('sync: 入力の送信と受け取り', () => {
  it('2 ステップに 1 回、直近 6 ステップを新しい順に送る', () => {
    const sender = new InputSender();
    const c = createNetControls();
    const sent: number[] = [];
    for (let seq = 1; seq <= 10; seq++) {
      c.roll = seq / 100;
      sender.record(seq, c);
      if (sender.ready()) {
        const m = sender.message();
        sent.push(m.seq);
        expect(m.controls[0]?.roll).toBeCloseTo(seq / 100);
        expect(m.controls).toHaveLength(Math.min(seq, NET_CONFIG.input.redundancyTicks));
        expect(m.controls.at(-1)?.roll).toBeCloseTo((seq - m.controls.length + 1) / 100);
      }
    }
    expect(sent).toEqual([2, 4, 6, 8, 10]);
  });

  it('ホストは溜めてから seq の順に 1 つずつ使い、失われたメッセージは複製で埋まる', () => {
    const sender = new InputSender();
    const buf = new InputBuffer();
    const c = createNetControls();
    const used: number[] = [];
    for (let seq = 1; seq <= 60; seq++) {
      c.roll = seq / 100;
      sender.record(seq, c);
      // 3 回に 1 回のメッセージが失われる
      if (sender.ready() && seq % 6 !== 0) buf.receive(sender.message());
      for (const u of buf.pull()) used.push(Math.round(u.roll * 100));
    }
    expect(buf.guessed).toBe(0);
    // 1 から順に抜けなく使う
    expect(used).toEqual(used.map((_, i) => i + 1));
    expect(used.length).toBeGreaterThan(50);
  });

  it('全部の複製が失われた seq・入力が切れたステップは直前の操作で埋めて進む（機体を止めない）', () => {
    const buf = new InputBuffer();
    const at = (seq: number) => ({ ...createNetControls(), roll: seq / 100 });
    const pullAll = (n: number): number[] => {
      const used: number[] = [];
      for (let k = 0; k < n; k++) for (const u of buf.pull()) used.push(Math.round(u.roll * 100));
      return used;
    };
    buf.receive({ type: 'input', seq: 4, controls: [at(4), at(3), at(2), at(1)] });
    // 溜まるまで（6 ステップ）は使わない
    expect(pullAll(3)).toEqual([]);
    // 5〜8 は届かず、9〜12 が届く
    buf.receive({ type: 'input', seq: 12, controls: [at(12), at(11), at(10), at(9)] });
    expect(pullAll(12)).toEqual([1, 2, 3, 4, 4, 4, 4, 4, 9, 10, 11, 12]);
    expect(buf.guessed).toBe(4);
    expect(buf.lastApplied).toBe(12);
    // 切れたら直前の操作で進み、間に合わなかった入力は後から届いても使わない
    expect(pullAll(2)).toEqual([12, 12]);
    expect(buf.starved).toBe(2);
    buf.receive({ type: 'input', seq: 16, controls: [at(16), at(15), at(14), at(13)] });
    expect(pullAll(2)).toEqual([15, 16]);
    expect(buf.lastApplied).toBe(16);
  });

  it('クライアントが大きく遅れたら溜め直す', () => {
    const buf = new InputBuffer();
    const at = (seq: number) => ({ ...createNetControls(), roll: seq / 100 });
    buf.receive({ type: 'input', seq: 6, controls: [6, 5, 4, 3, 2, 1].map(at) });
    for (let k = 0; k < 12 + NET_CONFIG.input.resyncTicks; k++) buf.pull();
    buf.receive({ type: 'input', seq: 12, controls: [12, 11, 10, 9, 8, 7].map(at) });
    expect(buf.pull().map((u) => Math.round(u.roll * 100))).toEqual([7]);
  });
});

describe('sync: クライアントの時間の遅れ', () => {
  it('クライアントがコマ落ちで 20 ステップ遅れたら、推測で埋め続けずに溜め直して合わせる', () => {
    const sender = new InputSender();
    const buf = new InputBuffer();
    const c = createNetControls();
    let clientSeq = 0;
    const usedReal: number[] = [];
    for (let tick = 1; tick <= 240; tick++) {
      // 60 ステップ目にクライアントが 20 ステップぶん止まる（0.25 秒を超えるコマ落ちで時間を失う）
      if (tick < 60 || tick >= 80) {
        clientSeq++;
        c.roll = clientSeq / 1000;
        sender.record(clientSeq, c);
        if (sender.ready()) buf.receive(sender.message());
      }
      for (const u of buf.pull()) if (tick > 150) usedReal.push(Math.round(u.roll * 1000));
    }
    expect(buf.resyncs).toBe(1);
    // 溜め直した後は推測なしでクライアントの seq を順に使う
    expect(usedReal.length).toBeGreaterThan(80);
    expect(usedReal).toEqual(usedReal.map((_, i) => (usedReal[0] ?? 0) + i));
  });
});
