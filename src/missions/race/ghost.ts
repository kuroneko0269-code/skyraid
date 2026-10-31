// リングレース（7-1）のゴースト（7-B でリプレイの記録に移した。Three.js 非依存）: ベストの走行の「入力の記録」
// （src/replay/）を、プレイヤーとは別の世界（FlightSession + GamePlay）で同じステップずつ再生する。
// 15Hz の位置の記録より再現性が高く（補間の誤差がない）、容量も小さい。墜落・ブーストもレースと同じ判定で再現する
import type { BuildingField } from '../../combat/buildings';
import { DEFENSE_CONFIG } from '../../data/defense';
import { FREE_FLIGHT_ENEMIES } from '../../data/ai';
import { createControls, type GroundHeightFn } from '../../entities/aircraft';
import type { Quat, Vec3 } from '../../flight/math';
import { decodeReplay, fromBase64 } from '../../replay/codec';
import { ReplayPlayer } from '../../replay/player';
import type { ReplayData } from '../../replay/types';
import { FlightSession } from '../flight-session';
import { GamePlay } from '../game-play';

/** 描画が引くゴーストの位置・姿勢 */
export interface GhostSource {
  /** alpha（固定ステップの補間）の位置・姿勢を書く。出さないとき（墜落中・走行の外）は false */
  sample(alpha: number, p: Vec3, q: Quat): boolean;
}

/** セーブのゴースト（base64）を記録に戻す。読めない・レースの記録でなければ null */
export function decodeGhost(data: string, courseId: string): ReplayData | null {
  try {
    const r = decodeReplay(fromBase64(data));
    return r.header.mode === 'race' && r.header.courseId === courseId ? r : null;
  } catch {
    return null;
  }
}

export class GhostSim implements GhostSource {
  readonly play: GamePlay;
  private player: ReplayPlayer | null = null;
  private readonly controls = createControls();

  /**
   * ground は今のマップの地表、buildings は街の建物（墜落の判定だけ。崩れの時間はプレイヤーの世界が進める）。
   * 敵の入れ物は本番の世界と同じ数（乱数の使い方を同じにする）
   */
  constructor(ground: GroundHeightFn, buildings: () => BuildingField | null) {
    this.play = new GamePlay(
      new FlightSession({
        groundHeight: ground,
        buildings,
        enemies: { ...FREE_FLIGHT_ENEMIES, maxCount: DEFENSE_CONFIG.hostFighterPool },
      }),
    );
  }

  /** 記録を読み込んでスタート地点から（null で止める）。レースの始め（プレイヤーと同じステップ）に呼ぶ */
  start(data: ReplayData | null): void {
    if (!data) {
      this.player = null;
      return;
    }
    const world = {
      play: this.play,
      // マップはプレイヤーの世界が切り替えてある
      useMap: () => undefined,
      // 街の崩れの時間はプレイヤーの世界だけが進める
      buildings: () => null,
    };
    this.player = new ReplayPlayer(world, data, this.controls, false);
    this.player.begin();
  }

  get active(): boolean {
    return this.player !== null;
  }

  /** プレイヤーの世界の固定ステップ 1 回ごとに 1 ステップ（記録の終わりで止まる） */
  step(): void {
    this.player?.step();
  }

  sample(alpha: number, p: Vec3, q: Quat): boolean {
    const pl = this.player;
    const race = this.play.race;
    if (!pl || !race || race.phase !== 'racing' || pl.ended || !this.play.session.player.active)
      return false;
    const a = this.play.session.aircraft;
    const s = a.state.position;
    const o = a.prevPosition;
    p.x = o.x + (s.x - o.x) * alpha;
    p.y = o.y + (s.y - o.y) * alpha;
    p.z = o.z + (s.z - o.z) * alpha;
    // 姿勢は近い側の半球で補間して正規化
    const r = a.state.orientation;
    const w = a.prevOrientation;
    const sign = r.x * w.x + r.y * w.y + r.z * w.z + r.w * w.w < 0 ? -1 : 1;
    q.x = w.x + (r.x * sign - w.x) * alpha;
    q.y = w.y + (r.y * sign - w.y) * alpha;
    q.z = w.z + (r.z * sign - w.z) * alpha;
    q.w = w.w + (r.w * sign - w.w) * alpha;
    const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    q.x /= n;
    q.y /= n;
    q.z /= n;
    q.w /= n;
    return true;
  }
}
