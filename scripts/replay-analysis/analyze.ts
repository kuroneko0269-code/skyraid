// 9-1 操作の診断: .skyreplay を本番と同じ判定（src/replay/sim.ts）で再生しながら集計する
import { createCombatInput } from '../../src/combat/combat-input';
import { decodeReplay } from '../../src/replay/codec';
import {
  applyCommand,
  applyFrame,
  simHash,
  startFromHeader,
  stepWorld,
} from '../../src/replay/sim';
import { createFrame, FRAME_CHANNELS, type ReplayData } from '../../src/replay/types';
import { createWorld } from '../../tests/replay-helpers';
import { ControlAnalyzer, type AnalyzerOptions } from './metrics';
import type { Totals } from './totals';

export interface ReplayAnalysis {
  readonly totals: Totals;
  /** 記録の題（ミッション id など。パイロット名は出さない） */
  readonly title: string;
  readonly gameVersion: string;
  /** 始めた直後の状態が記録と同じだったか（違えば判定の版が違い、結果がずれるかもしれない） */
  readonly startMatches: boolean;
  /** 記録の結果（成功など）と、再生した結果が合うか（記録に結果が無ければ null） */
  readonly outcomeMatches: boolean | null;
}

/** バイト列を読んで集計する。読めなければ例外 */
export function analyzeBytes(bytes: Uint8Array, options: AnalyzerOptions): ReplayAnalysis {
  return analyzeData(decodeReplay(bytes), options);
}

export function analyzeData(data: ReplayData, options: AnalyzerOptions): ReplayAnalysis {
  const h = data.header;
  const w = createWorld();
  startFromHeader(w, h);
  const startMatches = simHash(w) === h.startHash;
  const play = w.play;
  const analyzer = new ControlAnalyzer(play, options);
  const input = createCombatInput();
  const frame = createFrame();
  const cmds = data.commands;
  let ci = 0;
  const step = { controls: w.controls, input, assist: false };
  for (let t = 0; t < h.steps; t++) {
    for (;;) {
      const c = cmds[ci];
      if (!c || c.step > t) break;
      if (c.step === t) applyCommand(play, c);
      ci++;
    }
    FRAME_CHANNELS.forEach((k, i) => {
      frame[k] = data.channels[i]?.[t] ?? 0;
    });
    applyFrame(frame, w.controls, input, play.session);
    step.assist = (frame.flags & 4) !== 0;
    analyzer.before(step);
    stepWorld(play, w.buildings(), w.controls, input, 1 / 60);
    analyzer.after();
  }
  const totals = analyzer.finish();
  const recorded = h.outcome?.success;
  const status = play.runner?.status;
  return {
    totals,
    title: h.missionId ?? h.courseId ?? h.mode,
    gameVersion: h.gameVersion ?? '?',
    startMatches,
    outcomeMatches:
      recorded === undefined || h.mode !== 'mission' ? null : recorded === (status === 'success'),
  };
}
