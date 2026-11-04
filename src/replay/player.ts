// リプレイの再生（7-B。Three.js・DOM 非依存）: 記録の初期状態から世界を作り直し、記録した入力で固定ステップを進める。
// 1 秒ごとにキーフレームを撮り（再生しながら。保存はしない）、シークは目的の秒のキーフレームに戻してから残りを計算し直す。
// まだ計算していない先へのシークは、描画フレームごとに seekStepsPerFrame ステップずつ進める（画面を止めない）。
// 速さ・一時停止は呼び出し側（GameLoop の時間の倍率）。再生はセーブに触らない（報酬・記録は呼び出し側が止める）
import { createCombatInput, type CombatInput } from '../combat/combat-input';
import { REPLAY_CONFIG } from '../data/replay';
import type { AircraftControls } from '../entities/aircraft';
import { KeyframeStore } from './keyframes';
import {
  applyCommand,
  applyFrame,
  simCheckHash,
  simHash,
  simRoots,
  simSkip,
  startFromHeader,
  stepWorld,
  type SimWorld,
} from './sim';
import { createFrame, FRAME_CHANNELS, replayCheckHashes, type ReplayData } from './types';

export const STEP_SECONDS = 1 / 60;
const KEY_STEPS = Math.round(REPLAY_CONFIG.keyframeSeconds * 60);
/** 丸めたハッシュの間隔（9-4。記録と同じ 1 秒） */
const CHECK_STEPS = 60;

export class ReplayPlayer {
  readonly controls: AircraftControls;
  readonly input: CombatInput = createCombatInput();
  readonly keyframes: KeyframeStore;
  /** 進めたステップ数（0 は始めた直後） */
  private tickValue = 0;
  private commandIndex = 0;
  private seekTarget: number | null = null;
  private readonly frame = createFrame();
  /** 始めた直後の状態が記録と同じだったか（違えば判定の版が違うなどで再現できないかもしれない） */
  startMatches = true;
  /**
   * 9-4: 記録の毎秒の丸めたハッシュと最初に違った秒（null はまだ違っていない・記録にハッシュが無い）。
   * 端末の違い（数学関数の最後の桁）では変わらないので、違えばそこから結果が変わることがある
   */
  divergedAt: number | null = null;
  /** 最初に違ったとき（秒）。1 回の再生で 1 度だけ（シークで同じ所を通り直しても出さない） */
  onDiverge: ((seconds: number) => void) | null = null;
  /** 1 ステップ進めるたび（ステップ数）。テストの状態ハッシュ・演出のきっかけ */
  onStep: ((tick: number) => void) | null = null;
  private readonly checks: readonly string[] | null;

  constructor(
    private readonly world: SimWorld,
    readonly data: ReplayData,
    controls: AircraftControls,
    /** キーフレームを撮るか（シークしない再生（レースのゴースト）は撮らない） */
    private readonly withKeyframes = true,
  ) {
    this.controls = controls;
    this.checks = replayCheckHashes(data.header);
    this.keyframes = new KeyframeStore(() => simRoots(world), simSkip(world.play));
  }

  get steps(): number {
    return this.data.header.steps;
  }

  get tick(): number {
    return this.tickValue;
  }

  get seconds(): number {
    return this.tickValue * STEP_SECONDS;
  }

  get durationSeconds(): number {
    return this.steps * STEP_SECONDS;
  }

  get ended(): boolean {
    return this.tickValue >= this.steps;
  }

  /** 先へのシークを計算している途中か */
  get seeking(): boolean {
    return this.seekTarget !== null;
  }

  /** 世界を初期状態にして 0 ステップ目から（キーフレームも撮り直す）。started は世界をもう作ってあるとき（本番の飛行の始め） */
  begin(started = false): void {
    if (!started) startFromHeader(this.world, this.data.header);
    // 9-4 からの記録は丸めたハッシュで比べる（別の端末の記録でも、地形の高さの最後の桁の違いだけでは「違う」と出さない）
    const first = this.checks?.[0];
    this.startMatches =
      first !== undefined
        ? simCheckHash(this.world) === first
        : simHash(this.world) === this.data.header.startHash;
    this.divergedAt = null;
    this.tickValue = 0;
    this.commandIndex = 0;
    this.seekTarget = null;
    this.keyframes.clear();
    if (this.withKeyframes) this.keyframes.add();
  }

  /** 1 ステップ進める。終わりなら false */
  step(): boolean {
    const t = this.tickValue;
    if (t >= this.steps) return false;
    const cmds = this.data.commands;
    for (;;) {
      const c = cmds[this.commandIndex];
      if (!c || c.step > t) break;
      if (c.step === t) applyCommand(this.world.play, c);
      this.commandIndex++;
    }
    const f = this.frame;
    const ch = this.data.channels;
    FRAME_CHANNELS.forEach((k, i) => {
      f[k] = ch[i]?.[t] ?? 0;
    });
    const session = this.world.play.session;
    applyFrame(f, this.controls, this.input, session);
    stepWorld(this.world.play, this.world.buildings(), this.controls, this.input, STEP_SECONDS);
    this.tickValue = t + 1;
    // 計算した最も先の秒に達したらキーフレームを撮る
    if (
      this.withKeyframes &&
      this.tickValue % KEY_STEPS === 0 &&
      this.tickValue / KEY_STEPS === this.keyframes.count
    )
      this.keyframes.add();
    if (this.checks && this.divergedAt === null && this.tickValue % CHECK_STEPS === 0)
      this.compareCheck(this.tickValue / CHECK_STEPS);
    this.onStep?.(this.tickValue);
    return true;
  }

  /**
   * target ステップ目へ移る。撮ってあるキーフレームの範囲なら、その秒のキーフレームに戻して残り（1 秒未満）を計算する。
   * その先なら最後のキーフレームから計算を始め、advanceSeek で少しずつ進める。すぐ終わったら true
   */
  seek(target: number): boolean {
    const goal = Math.max(0, Math.min(this.steps, Math.round(target)));
    const k = Math.min(Math.floor(goal / KEY_STEPS), this.keyframes.count - 1);
    // 今より先で、今の位置から計算した方が近ければ戻さない
    if (!(goal >= this.tickValue && this.tickValue >= k * KEY_STEPS)) this.restoreKeyframe(k);
    this.seekTarget = goal;
    return this.advanceSeek(Number.POSITIVE_INFINITY);
  }

  /** シークの続き（最大 maxSteps ステップ）。終わったら true */
  advanceSeek(maxSteps: number = REPLAY_CONFIG.seekStepsPerFrame): boolean {
    const goal = this.seekTarget;
    if (goal === null) return true;
    let n = 0;
    while (this.tickValue < goal && n < maxSteps) {
      this.step();
      n++;
    }
    if (this.tickValue >= goal) {
      this.seekTarget = null;
      return true;
    }
    return false;
  }

  /** k 秒の時点の丸めたハッシュを比べる（記録の無い秒は比べない） */
  private compareCheck(k: number): void {
    const want = this.checks?.[k];
    if (want === undefined || simCheckHash(this.world) === want) return;
    this.divergedAt = k;
    this.onDiverge?.(k);
  }

  private restoreKeyframe(k: number): void {
    this.keyframes.restore(k);
    // 街の描画を作り直させる（version はキーフレームに入れていない）
    const b = this.world.buildings();
    if (b) b.version++;
    this.tickValue = k * KEY_STEPS;
    // そのステップより前のコマンドは済んでいる
    const cmds = this.data.commands;
    let i = 0;
    while (i < cmds.length && (cmds[i]?.step ?? 0) < this.tickValue) i++;
    this.commandIndex = i;
  }
}
