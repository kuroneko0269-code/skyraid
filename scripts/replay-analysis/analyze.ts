// 9-1 操作の診断: .skyreplay を本番と同じ判定（src/replay/sim.ts）で再生しながら集計する
import { createCombatInput } from '../../src/combat/combat-input';
import { decodeReplay } from '../../src/replay/codec';
import {
  applyCommand,
  applyFrame,
  simCheckHash,
  simHash,
  startFromHeader,
  stepWorld,
} from '../../src/replay/sim';
import {
  replayCheckHashes,
  createFrame,
  FRAME_CHANNELS,
  type ReplayData,
  type ReplayHeader,
} from '../../src/replay/types';
import type { Locale } from '../../src/core/locale';
import { useLocale } from '../../tests/i18n-helpers';
import { createWorld, type TestWorld } from '../../tests/replay-helpers';
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
  const { w, startMatches } = startWorld(h);
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

/** 記録した言語の候補（部位の名前などの文言が状態に入るので、ハッシュは記録した言語でないと合わない。言語は記録に無い） */
const LOCALES: readonly Locale[] = ['ja', 'en'];

/**
 * 本番と同じ形の世界で始める（9-2 の事前修正）: 爆弾・ロケットの建物への当たり（ui/mission-wiring.ts）と、起動のときの
 * 敵の設定（セーブの設定。記録のヘッダの値で代える）を入れ、記録した言語を候補から探す。どれも合わなければ日本語のまま。
 * それでも合わないのは、ブラウザと Node.js で Math.exp・Math.cos の結果が最後の桁で違うため（地形の高さに効く。docs/control-analysis.md）
 */
function startWorld(h: ReplayHeader): { w: TestWorld; startMatches: boolean } {
  for (const locale of LOCALES) {
    useLocale(locale);
    const w = createWorld({ enemies: h.enemies });
    startFromHeader(w, h);
    // 9-4 からの記録は数を丸めたハッシュで比べる（ブラウザと Node.js の最後の桁の違いでは変わらない）
    const first = replayCheckHashes(h)?.[0];
    if (first !== undefined ? simCheckHash(w) === first : simHash(w) === h.startHash)
      return { w, startMatches: true };
  }
  useLocale('ja');
  const w = createWorld({ enemies: h.enemies });
  startFromHeader(w, h);
  return { w, startMatches: false };
}
