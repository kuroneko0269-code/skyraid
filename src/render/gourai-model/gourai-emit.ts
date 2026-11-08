// 10-7c: メカ怪獣ゴウライの粒の出し方（描画だけ。乱数は Math.random）: 爆発（炎の芯と外・火花・破片・煙）・蒸気・熱のゆらぎ・
// 推進器の吹き出し・海面の吹きおろしのしぶき・登場で体から落ちる水・撃破の水柱。粒の入れ物は共通の kaiju-look/
import { Color, Vector3 } from 'three';
import { GOURAI_VISUAL } from '../../data/gourai-visual';
import type { KaijuDebris } from '../kaiju-look/debris';
import type { KaijuPuffs } from '../kaiju-look/puffs';
import type { KaijuStreaks } from '../kaiju-look/streaks';

const V = GOURAI_VISUAL;
const C = V.colors;
const v1 = new Vector3();
const v2 = new Vector3();
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class GouraiEmit {
  /** 煙・蒸気の色（空の明るさを掛ける。毎フレーム gourai-effects.ts が入れる） */
  readonly steam = new Color(C.steam);
  readonly smoke = new Color(C.smoke);
  readonly splash = new Color(C.splash);
  private readonly fireC = new Color(C.fire);
  private readonly coreC = new Color(C.fireCore);
  private readonly hazeC = new Color(C.haze);
  private readonly hoverC = new Color(C.hover);

  constructor(
    private readonly puffs: KaijuPuffs,
    private readonly fire: KaijuPuffs,
    private readonly sparks: KaijuStreaks,
    private readonly debris: KaijuDebris,
    private readonly sparkCap: number,
  ) {}

  /** 火花を n 本（at から全方向。vel は体の速さ） */
  sparkBurst(at: Readonly<Vector3>, vel: Readonly<Vector3>, n: number, speed = 90): void {
    const m = Math.min(n, this.sparkCap);
    for (let i = 0; i < m; i++) {
      v1.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1))
        .normalize()
        .multiplyScalar(speed * rand(0.4, 1))
        .add(vel);
      this.sparks.emit(at, v1, rand(4, V.streaks.windLength * 1.4), rand(0.3, V.streaks.windLife));
    }
  }

  /** 爆発（炎の芯と外・火花・破片・煙）。scale 1 で部位の破壊の大きさ */
  blast(at: Readonly<Vector3>, vel: Readonly<Vector3>, scale: number, shards: number): void {
    const B = V.blast;
    for (let i = 0; i < 9; i++) {
      v1.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1))
        .multiplyScalar(14 * scale)
        .add(at);
      v2.set(rand(-1, 1), rand(0, 1), rand(-1, 1))
        .multiplyScalar(18 * scale)
        .add(vel);
      this.fire.emit(v1, v2, {
        size: B.size * scale * rand(0.6, 1.1),
        grow: 2.2,
        life: B.life * rand(0.7, 1.2),
        alpha: 1,
        color: i < 3 ? this.coreC : this.fireC,
        drag: 2,
        fadeIn: 0.02,
      });
    }
    this.sparkBurst(at, vel, Math.round(B.sparks * Math.min(1.5, scale)), 110 * Math.sqrt(scale));
    if (shards > 0) this.debris.burst(at, vel, shards, true);
    for (let i = 0; i < 3; i++) {
      v1.set(rand(-1, 1), rand(0, 1), rand(-1, 1))
        .multiplyScalar(10 * scale)
        .add(at);
      this.puffs.emit(v1, v2.set(0, 10, 0).add(vel), {
        size: B.size * scale * 1.3,
        grow: 2.6,
        life: 4,
        alpha: 0.55,
        color: this.smoke,
        drag: 0.5,
        fadeIn: 0.2,
        age: -0.25,
      });
    }
  }

  /** 蒸気（at から上へ。dir は吹き出す向き） */
  steamPuff(at: Readonly<Vector3>, dir: Readonly<Vector3>, scale = 1): void {
    const S = V.steam;
    v1.copy(dir).multiplyScalar(S.rise * rand(0.7, 1.3) * scale);
    v1.x += rand(-4, 4);
    v1.z += rand(-4, 4);
    this.puffs.emit(at, v1, {
      size: S.size * scale * rand(0.7, 1.2),
      grow: 3,
      life: S.life * rand(0.7, 1.2),
      alpha: 0.45,
      color: this.steam,
      drag: 0.6,
      fadeIn: 0.08,
    });
  }

  /** 熱のゆらぎ（排気口の後ろ・推進器の下。かすかに光って揺れる）。cool は推進器（青白） */
  haze(at: Readonly<Vector3>, dir: Readonly<Vector3>, strength: number, cool: boolean): void {
    const H = V.haze;
    v1.copy(dir).multiplyScalar(rand(30, 60));
    v1.x += rand(-6, 6);
    v1.y += rand(-3, 6);
    v1.z += rand(-6, 6);
    this.fire.emit(at, v1, {
      size: H.size * rand(0.7, 1.3),
      grow: 2.2,
      life: H.life * rand(0.7, 1.2),
      alpha: H.alpha * strength * (cool ? 1.4 : 1),
      color: cool ? this.hoverC : this.hazeC,
      drag: 1.2,
      fadeIn: 0.15,
    });
  }

  /** 黒い煙（壊れた排気口・倒れて沈む間） */
  smokePuff(at: Readonly<Vector3>, vel: Readonly<Vector3>, size: number): void {
    v1.copy(vel);
    v1.y += rand(8, 16);
    this.puffs.emit(at, v1, {
      size: size * rand(0.7, 1.2),
      grow: 3,
      life: 5,
      alpha: 0.5,
      color: this.smoke,
      drag: 0.4,
      fadeIn: 0.15,
    });
  }

  /** 海面の吹きおろしのしぶき（体の真下の輪） */
  wash(center: Readonly<Vector3>, floor: number, strength: number): void {
    const W = V.wash;
    const a = Math.random() * Math.PI * 2;
    const r = rand(20, 70);
    v1.set(center.x + Math.cos(a) * r, floor + 3, center.z + Math.sin(a) * r);
    v2.set(Math.cos(a) * 30, rand(6, 14), Math.sin(a) * 30);
    this.puffs.emit(v1, v2, {
      size: W.size * rand(0.7, 1.3),
      grow: 2.4,
      life: 2.2,
      alpha: 0.35 * strength,
      color: this.splash,
      drag: 0.8,
      fadeIn: 0.1,
    });
  }

  /** 登場で体から落ちる水（at から下へ。重さあり）と水面のしぶき */
  cascade(at: Readonly<Vector3>, floor: number): void {
    v1.set(rand(-6, 6), rand(-4, 2), rand(-6, 6));
    this.puffs.emit(at, v1, {
      size: rand(12, 24),
      grow: 2.4,
      life: 2.4,
      alpha: 0.6,
      color: this.splash,
      gravity: 30,
      drag: 0.3,
      fadeIn: 0.05,
    });
    if (at.y - floor < 40 && Math.random() < 0.5) {
      v2.set(at.x, floor + 2, at.z);
      this.puffs.emit(v2, v1.set(rand(-10, 10), rand(16, 30), rand(-10, 10)), {
        size: rand(14, 26),
        grow: 2.6,
        life: 1.6,
        alpha: 0.45,
        color: this.splash,
        gravity: 14,
        drag: 0.5,
        fadeIn: 0.05,
      });
    }
  }

  /** 撃破で海に着いたときの水柱（count 粒）と蒸気 */
  column(center: Readonly<Vector3>, floor: number): void {
    const S = V.splash;
    for (let i = 0; i < S.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(0, 90);
      v1.set(center.x + Math.cos(a) * r, floor + 4, center.z + Math.sin(a) * r * 1.4);
      const up = Math.sqrt(2 * 30 * S.height) * rand(0.35, 1);
      v2.set(Math.cos(a) * rand(5, 30), up, Math.sin(a) * rand(5, 30));
      this.puffs.emit(v1, v2, {
        size: rand(18, 34),
        grow: 2.4,
        life: rand(3, 5),
        alpha: 0.6,
        color: i % 4 === 0 ? this.steam : this.splash,
        gravity: 30,
        drag: 0.2,
        fadeIn: 0.03,
      });
    }
  }
}
