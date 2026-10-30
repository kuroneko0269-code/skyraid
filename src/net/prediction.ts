// クライアントの自機の先行計算と補正（5-1）。自機は手元で量子化した操作で計算し（遅れなく操作できる）、
// ステップごとの位置・姿勢・速さを seq で記録する。ホストの状態（その機体に使った最後の seq つき）が届いたら
// 同じ seq の記録と比べ、ずれていれば差を今の状態とそれ以降の記録に足す。ホストも同じ操作・同じ回数で計算するので
// ふだんはずれず、入力の複製が全部失われてホストが推測で埋めたときだけ補正が入る。Three.js 非依存
import { NET_CONFIG } from '../data/net';
import { multiplyQuat, normalizeQuat, type Quat, type Vec3 } from '../flight/math';
import type { AircraftStateMsg } from './protocol';

const P = NET_CONFIG.prediction;

/** 補正の対象（FlightState と Aircraft.prevPosition / prevOrientation） */
export interface PredictedBody {
  readonly position: Vec3;
  readonly orientation: Quat;
  speed: number;
  readonly prevPosition: Vec3;
  readonly prevOrientation: Quat;
}

interface Record {
  seq: number;
  readonly position: Vec3;
  readonly orientation: Quat;
  speed: number;
}

export type ReconcileResult = 'none' | 'unknown' | 'corrected' | 'snapped';

const dq: Quat = { x: 0, y: 0, z: 0, w: 1 };
const inv: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** q を dq で回す（dq × q） */
function rotateQuat(q: Quat): void {
  multiplyQuat(q, dq, q);
  normalizeQuat(q);
}

export class OwnPrediction {
  private readonly history: Record[] = [];
  /** 補正した回数（?netdebug） */
  corrections = 0;
  /** 最後の比較のずれ（m） */
  lastError = 0;

  constructor() {
    for (let i = 0; i < P.historyTicks; i++) {
      this.history.push({
        seq: -1,
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        speed: 0,
      });
    }
  }

  reset(): void {
    for (const r of this.history) r.seq = -1;
  }

  /** seq のステップを計算した後の状態を記録する */
  record(seq: number, body: Readonly<PredictedBody>): void {
    const r = this.history[seq % P.historyTicks];
    if (!r) return;
    r.seq = seq;
    r.position.x = body.position.x;
    r.position.y = body.position.y;
    r.position.z = body.position.z;
    r.orientation.x = body.orientation.x;
    r.orientation.y = body.orientation.y;
    r.orientation.z = body.orientation.z;
    r.orientation.w = body.orientation.w;
    r.speed = body.speed;
  }

  /** ホストの状態と比べて、ずれていれば body（と seq より後の記録）を直す。newestSeq は今のステップ */
  reconcile(
    host: Readonly<AircraftStateMsg>,
    body: PredictedBody,
    newestSeq: number,
  ): ReconcileResult {
    const seq = host.lastInputSeq;
    const r = seq > 0 ? this.history[seq % P.historyTicks] : undefined;
    if (!r || r.seq !== seq) return 'unknown';
    const ex = host.position.x - r.position.x;
    const ey = host.position.y - r.position.y;
    const ez = host.position.z - r.position.z;
    const err = Math.hypot(ex, ey, ez);
    this.lastError = err;
    if (err < P.correctThreshold) return 'none';
    // 姿勢の差 dq = host × conj(記録)
    inv.x = -r.orientation.x;
    inv.y = -r.orientation.y;
    inv.z = -r.orientation.z;
    inv.w = r.orientation.w;
    multiplyQuat(dq, host.orientation, inv);
    normalizeQuat(dq);
    const dSpeed = host.speed - r.speed;
    // 今の状態と、seq から今までの記録に同じ差を足す（次の比較で二重に直さない）
    for (let s = seq; s <= newestSeq; s++) {
      const h = this.history[s % P.historyTicks];
      if (!h || h.seq !== s) continue;
      h.position.x += ex;
      h.position.y += ey;
      h.position.z += ez;
      rotateQuat(h.orientation);
      h.speed += dSpeed;
    }
    body.position.x += ex;
    body.position.y += ey;
    body.position.z += ez;
    rotateQuat(body.orientation);
    body.speed += dSpeed;
    // 描画の補間の前の位置も同じだけ動かす（補正の分だけ線を引かない）
    body.prevPosition.x += ex;
    body.prevPosition.y += ey;
    body.prevPosition.z += ez;
    rotateQuat(body.prevOrientation);
    this.corrections++;
    return err >= P.snapThreshold ? 'snapped' : 'corrected';
  }
}
