import { describe, expect, it } from 'vitest';
import { GameLoop, type FrameScheduler } from '../src/core/loop';
import { LOOP_CONFIG } from '../src/data/loop';

const STEP = 1 / 60;

/** 手動で時刻とフレームを進める偽スケジューラ */
function createFakeScheduler() {
  let time = 0;
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const scheduler: FrameScheduler = {
    now: () => time,
    request: (cb) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    },
    cancel: (id) => {
      pending.delete(id);
    },
  };
  /** ms 進めてから待機中のフレームを1回実行する */
  const frame = (ms: number) => {
    time += ms;
    const cbs = [...pending.values()];
    pending.clear();
    for (const cb of cbs) cb();
  };
  return { scheduler, frame, pendingCount: () => pending.size };
}

describe('GameLoop.advance', () => {
  it('既定は 60Hz で、update には常に 1/60 秒が渡る', () => {
    const loop = new GameLoop();
    const dts: number[] = [];
    loop.onUpdate((dt) => dts.push(dt));
    expect(loop.advance(STEP)).toBe(1);
    expect(loop.advance(STEP * 3)).toBe(3);
    expect(dts).toHaveLength(4);
    for (const dt of dts) expect(dt).toBeCloseTo(STEP, 12);
  });

  it('1/60 秒を 60 回進めると更新はちょうど 60 回', () => {
    const loop = new GameLoop();
    let count = 0;
    loop.onUpdate(() => count++);
    for (let i = 0; i < 60; i++) loop.advance(STEP);
    expect(count).toBe(60);
  });

  it('端数は蓄積され、render の alpha に反映される', () => {
    const loop = new GameLoop();
    const alphas: number[] = [];
    loop.onRender((a) => alphas.push(a));
    expect(loop.advance(STEP / 2)).toBe(0);
    expect(alphas[0]).toBeCloseTo(0.5, 6);
    expect(loop.advance(STEP * 0.75)).toBe(1);
    expect(alphas[1]).toBeCloseTo(0.25, 6);
  });

  it('render は固定更新の回数に関わらずフレームごとに1回', () => {
    const loop = new GameLoop();
    let renders = 0;
    loop.onRender(() => renders++);
    loop.advance(0);
    loop.advance(STEP * 5);
    expect(renders).toBe(2);
  });

  it('巨大な dt は maxFrameSeconds でクランプされる', () => {
    const loop = new GameLoop();
    let count = 0;
    loop.onUpdate(() => count++);
    loop.advance(30); // タブを 30 秒放置して戻った想定
    expect(count).toBe(Math.round(LOOP_CONFIG.maxFrameSeconds / STEP));
  });

  it('負の dt や NaN では時間が進まない', () => {
    const loop = new GameLoop();
    let count = 0;
    loop.onUpdate(() => count++);
    expect(loop.advance(-1)).toBe(0);
    expect(loop.advance(Number.NaN)).toBe(0);
    expect(count).toBe(0);
  });

  it('登録解除した関数は呼ばれない', () => {
    const loop = new GameLoop();
    let count = 0;
    const off = loop.onUpdate(() => count++);
    loop.advance(STEP);
    off();
    loop.advance(STEP);
    expect(count).toBe(1);
  });

  it('updateHz を変えられる', () => {
    const loop = new GameLoop({ updateHz: 30 });
    expect(loop.stepSeconds).toBeCloseTo(1 / 30, 12);
    expect(loop.advance(0.1)).toBe(3);
  });
});

describe('GameLoop.start / stop', () => {
  it('スケジューラの時刻差で時間が進む', () => {
    const { scheduler, frame } = createFakeScheduler();
    const loop = new GameLoop();
    let updates = 0;
    let renders = 0;
    loop.onUpdate(() => updates++);
    loop.onRender(() => renders++);
    loop.start(scheduler);
    expect(loop.running).toBe(true);

    frame(0); // 初回フレームは描画のみ
    expect(updates).toBe(0);
    expect(renders).toBe(1);

    for (let i = 0; i < 60; i++) frame(1000 / 60);
    expect(updates).toBe(60);
    expect(renders).toBe(61);
  });

  it('stop 後はフレームが予約されない', () => {
    const { scheduler, frame, pendingCount } = createFakeScheduler();
    const loop = new GameLoop();
    let renders = 0;
    loop.onRender(() => renders++);
    loop.start(scheduler);
    frame(16);
    loop.stop();
    expect(loop.running).toBe(false);
    expect(pendingCount()).toBe(0);
    frame(16);
    expect(renders).toBe(1);
  });

  it('非表示中に止まった rAF が再開しても更新は上限まで', () => {
    const { scheduler, frame } = createFakeScheduler();
    const loop = new GameLoop();
    let updates = 0;
    loop.onUpdate(() => updates++);
    loop.start(scheduler);
    frame(0);
    frame(60_000); // 1分後に復帰
    expect(updates).toBe(Math.round(LOOP_CONFIG.maxFrameSeconds / STEP));
  });
});
