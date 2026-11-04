// リプレイ（7-B）の本番側の要（Three.js・DOM 非依存）: 本番の飛行の記録（ReplayRecorder）・再生中かどうか・外部の操作の
// 通り道。レース・防衛戦・ミッションの配線は playing を見て、再生中は報酬・記録・リザルトを止める（セーブに影響しない）
import type { CombatInput } from '../combat/combat-input';
import type { CombatTarget } from '../combat/target';
import type { AircraftControls } from '../entities/aircraft';
import type { GamePlay } from '../missions/game-play';
import { toBase64, encodeReplay } from './codec';
import { ReplayRecorder } from './recorder';
import { applyCommand, applyFrame, captureFrame, simCheckHash } from './sim';
import type { BuildingField } from '../combat/buildings';
import type { ReplayCommand, ReplayData } from './types';

type CommandBody = ReplayCommand extends infer C
  ? C extends unknown
    ? Omit<C, 'step'>
    : never
  : never;

export class ReplayHub {
  /** 再生中か（報酬・記録・リザルトを止める） */
  playing = false;
  /** 一覧で選んだ、これから再生する記録 */
  pending: ReplayData | null = null;
  readonly recorder = new ReplayRecorder();

  constructor(private readonly play: GamePlay) {}

  /** 本番の飛行を記録しているか */
  get recording(): boolean {
    return this.recorder.active && !this.playing;
  }

  /**
   * 本番の固定ステップの直前: 操作を記録の形（量子化）にして記録し、記録した値で操作を上書きする
   * （記録と判定の値をそろえる。記録していないとき（PvP・チュートリアル）は何もしない）
   */
  capture(controls: AircraftControls, input: CombatInput): void {
    if (!this.recording) return;
    const session = this.play.session;
    const f = captureFrame(this.recorder.frame, controls, input, session);
    applyFrame(f, controls, input, session);
    this.recorder.push(f);
  }

  /**
   * 9-4: 記録の始め（固定ステップの前）と、固定ステップの後に呼ぶ。1 秒ごとに丸めた状態のハッシュを残す
   * （再生で端末の違いによるずれを見つける）
   */
  checkpoint(buildings: BuildingField | null): void {
    if (!this.recording || !this.recorder.wantsCheck) return;
    this.recorder.check(simCheckHash({ play: this.play, buildings: () => buildings }));
  }

  /** 外部の操作をその場で効かせ、記録中なら残す */
  dispatch(c: CommandBody): void {
    applyCommand(this.play, { ...c, step: 0 });
    if (this.recording) this.recorder.command(c);
  }

  /** HUD のタップで対象を選ぶ（自分の世界の対象なら記録する。PvP の他機はその場で選ぶだけ） */
  select(target: CombatTarget | null): void {
    const combat = this.play.session.combat;
    const i = target ? combat.allTargets.indexOf(target) : -1;
    if (target && i < 0) combat.targeting.select(target);
    else this.dispatch({ kind: 'select', target: i });
  }

  /** 今の記録のゴースト（レース。base64）。記録していなければ空 */
  ghostData(): string {
    const d = this.recorder.snapshot(null);
    return d ? toBase64(encodeReplay(d)) : '';
  }
}
