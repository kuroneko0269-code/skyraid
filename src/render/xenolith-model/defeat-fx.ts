// 10-7d: UFO ゼノリスの撃破の演出（描画だけ。xenolith-effects.ts から分けた）: 倒れた後は光が消え、電気の弧が円盤を走り、煙を引いて
// 落ちる。海に着いたら面の光の波と水しぶきの柱。乱数は Math.random（見た目だけ）
import { Vector3 } from 'three';
import { XENOLITH_VISUAL } from '../../data/xenolith-visual';
import type { XenolithTierSpec } from '../../data/xenolith-visual';
import type { KaijuArcs } from '../kaiju-look/arcs';
import type { KaijuPuffs } from '../kaiju-look/puffs';
import type { XenolithViewInput } from './xenolith-effects';
import type { WaveFx } from './waves';

const V = XENOLITH_VISUAL;
const v1 = new Vector3();
const v2 = new Vector3();
const drift = new Vector3();
const at = new Vector3();

/** 縁の点（体の座標の角度 a・半径 r・高さ y）をワールドへ */
const rim = (out: Vector3, c: Readonly<Vector3>, a: number, r: number, y: number): Vector3 =>
  out.set(c.x + Math.sin(a) * r, c.y + y, c.z - Math.cos(a) * r);

/** 倒れた後の 1 フレーム（wasLanded は前のフレームで海に着いていたか・floor は真下の床） */
export function stepDefeat(
  fx: {
    readonly arcs: KaijuArcs | null;
    readonly puffs: KaijuPuffs;
    readonly waves: WaveFx;
    readonly spec: XenolithTierSpec;
  },
  center: Readonly<Vector3>,
  vel: Readonly<Vector3>,
  input: XenolithViewInput,
  wasLanded: boolean,
  deadTime: number,
  floor: number,
): void {
  const dt = input.fxDt;
  if (input.dead) {
    if (fx.arcs && dt > 0 && deadTime < 3.5 && Math.random() < dt * 10) {
      const a = Math.random() * Math.PI * 2;
      rim(v1, center, a, 30 + Math.random() * 50, 6);
      rim(v2, center, a + (Math.random() - 0.5) * 1.6, 50 + Math.random() * 30, 0);
      fx.arcs.spark(v1, v2, 0.25, 1.6, 0.18, 1.5);
    }
    if (dt > 0 && !input.landed && Math.random() < dt * 8)
      fx.puffs.emit(
        rim(v1, center, Math.random() * 6.3, Math.random() * 60, 4),
        drift.copy(vel).multiplyScalar(0.2),
        {
          size: 26,
          grow: 2.6,
          life: 3,
          alpha: 0.5,
          color: V.colors.smoke,
          drag: 0.6,
        },
      );
  }
  if (input.landed && !wasLanded) {
    v1.set(center.x, floor + 2, center.z);
    fx.waves.emit(v1, 260, 0.08, 0.8);
    for (let i = 0; i < Math.min(V.splash.count, fx.spec.puffs); i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 70;
      v2.set(Math.cos(a) * 20, V.splash.height * (0.4 + Math.random() * 0.8), Math.sin(a) * 20);
      fx.puffs.emit(at.set(v1.x + Math.cos(a) * r, v1.y, v1.z + Math.sin(a) * r), v2, {
        size: 22 + Math.random() * 20,
        grow: 2.2,
        life: 2.5 + Math.random(),
        alpha: 0.6,
        color: V.colors.splash,
        gravity: 60,
        drag: 0.4,
      });
    }
  }
}
