// v1.0.1: 起動時の測り直しの試み（src/core/viewport-nudge.ts）。v1.0.0 の実機では、起動直後の値が縦（402×812）で、
// 横の短い値（812×340）になったのが 1.3 秒後だったため、0.6 秒の判定で終わって幕も試みも出ず、下の黒い余白が残った
import { describe, expect, it } from 'vitest';
import { StartupNudge, type NudgeConfig } from '../src/core/viewport-nudge';

const CONFIG: NudgeConfig = {
  atMs: [600, 2500],
  maxTries: 2,
  restoreMs: 150,
  checkMs: 400,
  watchMs: 8000,
  settleMs: 400,
};

/** 時刻を手で進める偽のタイマーと、端末の状態（short: 描かれる高さが足りないか） */
function rig(opts: { shortFrom?: number; fixedAfterTry?: number; canNudge?: boolean } = {}) {
  let t = 0;
  let tries = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const log: string[] = [];
  const isShort = (): boolean =>
    opts.shortFrom !== undefined &&
    t >= opts.shortFrom &&
    (opts.fixedAfterTry === undefined || tries < opts.fixedAfterTry);
  let auto = false;
  const nudge = new StartupNudge(
    {
      now: () => t,
      isShort,
      canNudge: () => opts.canNudge ?? true,
      describe: () => (isShort() ? 'short' : 'ok'),
      setFitAuto: (a) => {
        if (auto && !a) tries++;
        auto = a;
        log.push(a ? 'fit auto' : 'fit cover');
      },
      refit: () => {
        log.push('refit');
      },
      later: (fn, ms) => {
        timers.push({ at: t + ms, fn });
      },
      showCover: () => {
        log.push(`cover on @${t}`);
      },
      extendCover: () => {},
      hideCover: (reason) => {
        log.push(`cover off @${t} (${reason})`);
      },
      log: (kind, text) => {
        log.push(`${kind}: ${text.split(' (')[0]} @${t}`);
      },
    },
    CONFIG,
  );
  /** ms まで進める（途中で測る = check を 100ms ごとに呼ぶ。実際は resize や起動からの測り直しで呼ばれる） */
  const run = (until: number): void => {
    while (t < until) {
      t = Math.min(until, t + 50);
      if (t % 100 === 0) nudge.check();
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > t) break;
        timers.shift();
        next.fn();
      }
    }
  };
  nudge.check();
  return { nudge, log, run };
}

describe('StartupNudge（起動時の測り直しの試み）', () => {
  it('起動直後から短い（8-6e の実機の値）: 8-6f と同じ時刻（0.6 秒・2.5 秒）に試み、尽きたら幕を外す', () => {
    const { log, run, nudge } = rig({ shortFrom: 0 });
    run(10000);
    expect(log).toContain('cover on @0');
    expect(log).toContain('nudge: #1 auto @600');
    expect(log).toContain('nudge: #2 auto @2500');
    expect(log.at(-1)).toMatch(/^cover off @3050 \(tries done\)/);
    expect(nudge.phase).toBe('done');
  });

  it('2 回目で直った（8-6f の実機）: 直ったら幕を外す', () => {
    const { log, run } = rig({ shortFrom: 0, fixedAfterTry: 2 });
    run(10000);
    expect(log.filter((l) => l.startsWith('nudge: #') && l.includes('auto'))).toHaveLength(2);
    expect(log.at(-1)).toMatch(/\(fixed\)$/);
  });

  it('v1.0.0 の退行: 起動直後は縦の値で、1.3 秒後に短くなった → その時に幕を出し、落ち着くのを待って試みる', () => {
    const { log, run } = rig({ shortFrom: 1300 });
    run(10000);
    expect(log).toContain('cover on @1300');
    // 0.6 秒を過ぎているので settleMs（400）後に 1 回目、その 1.9 秒後に 2 回目
    expect(log).toContain('nudge: #1 auto @1700');
    expect(log).toContain('nudge: #2 auto @3600');
    expect(log.some((l) => l.startsWith('cover off'))).toBe(true);
    expect(log.some((l) => l.includes('never short'))).toBe(false);
  });

  it('ずっと短くならない（Safari・正しい大きさの起動）: 幕も試みも出さず、見張りの終わりを記録する', () => {
    const { log, run, nudge } = rig();
    run(10000);
    expect(log.some((l) => l.startsWith('cover on'))).toBe(false);
    expect(log.some((l) => l.includes('fit auto'))).toBe(false);
    expect(log).toContain('startup: end: never short @8000');
    expect(nudge.phase).toBe('done');
  });

  it('見張りの時間を過ぎてから短くなっても、幕は出さない（遊んでいる途中に黒くしない）', () => {
    const { log, run } = rig({ shortFrom: 9000 });
    run(12000);
    expect(log.some((l) => l.startsWith('cover on'))).toBe(false);
  });

  it('viewport-fit=cover が無ければ試みず、幕を外す', () => {
    const { log, run } = rig({ shortFrom: 0, canNudge: false });
    run(10000);
    expect(log.some((l) => l.includes('fit auto'))).toBe(false);
    expect(log.at(-1)).toMatch(/no viewport-fit=cover/);
  });
});
