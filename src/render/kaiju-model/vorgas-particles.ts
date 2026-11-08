// 10-7e: ヴォルガスの粒（描画だけ。乱数は Math.random = 見た目だけ）: 柔らかい粒（土煙・水しぶき・上陸の滝・湯気・煙）・光る粒（熱線の溜めで
// 口へ吸い込む粒・口の光・亀裂の火の粉）・破片と煙。土煙の輪 / 水しぶきと、毎フレーム出し続ける粒（vorgas-effects.ts が合図を出す）
import { Vector3 } from 'three';
import { VORGAS_VISUAL, type VorgasTierSpec } from '../../data/vorgas-visual';
import type { KaijuBodyView } from '../../entities/kaiju-display';
import { KaijuDebris } from '../kaiju-look/debris';
import { KaijuPuffs } from '../kaiju-look/puffs';
import { BONE, type BoneName, type KaijuSkeleton } from './skeleton';
import type { VorgasLookValues } from './skin-material';
import type { VorgasViewInput } from './vorgas-view';

const V = VORGAS_VISUAL;
const COL = V.colors;
const MOUTH = new Vector3(0, -4, -20);
const v1 = new Vector3();
const v2 = new Vector3();
const vel = new Vector3();
const rd = new Vector3();

export function randomDir(): Vector3 {
  return rd.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
}

/** 部位（KAIJU_PARTS の順）を壊したときに破片が出る骨 */
export const PART_BONE: readonly BoneName[] = ['head', 'chest', 'shinL', 'shinR', 'tail2'];
/** 体の表面の目安（上陸の水・亀裂の火の粉・倒れた土煙を出す骨） */
export const BODY_BONES: readonly BoneName[] = [
  'pelvis',
  'chest',
  'neck',
  'head',
  'armLUpper',
  'armRUpper',
  'thighL',
  'thighR',
  'tail0',
  'tail1',
  'tail2',
];

export class VorgasParticles {
  readonly puffs: KaijuPuffs;
  readonly embers: KaijuPuffs;
  readonly debris: KaijuDebris;
  /** マテリアルへ渡す値（vorgas-effects.ts が書く） */
  readonly look: VorgasLookValues = {
    heat: 0,
    throat: 0,
    wet: 0,
    dead: 0,
    breath: 0,
    flash: 0,
    crack: [1, 1, 1, 1, 1],
  };
  protected readonly smokeLeft = [0, 0, 0, 0, 0];
  private emberAcc = 0;
  private waterAcc = 0;
  private chargeAcc = 0;

  constructor(
    protected readonly spec: VorgasTierSpec,
    protected readonly rig: KaijuSkeleton,
  ) {
    this.puffs = new KaijuPuffs(spec.puffs);
    this.embers = new KaijuPuffs(spec.embers, true);
    this.debris = new KaijuDebris(spec.debris, V.fx);
  }

  protected bone(out: Vector3, n: BoneName, local?: Readonly<Vector3>): Vector3 {
    const b = this.rig.bones[BONE[n]];
    if (!b) return out;
    if (local) return out.copy(local).applyMatrix4(b.matrixWorld);
    return out.setFromMatrixPosition(b.matrixWorld);
  }

  /** 体の表面の近くの点（骨の位置から半径 r の中） */
  protected nearBody(out: Vector3, r: number): Vector3 {
    const n = BODY_BONES[Math.floor(Math.random() * BODY_BONES.length)] ?? 'chest';
    return this.bone(out, n).addScaledVector(randomDir(), r * Math.random());
  }

  /** 土煙の輪（陸）か水しぶき（海） */
  protected splash(
    at: Readonly<Vector3>,
    floor: number,
    water: boolean,
    n: number,
    size: number,
    speed: number,
  ): void {
    const count = Math.max(2, Math.round(n * (this.spec.puffs / 300)));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      v1.set(at.x + Math.cos(a) * size * 0.4, floor + 2, at.z + Math.sin(a) * size * 0.4);
      if (water)
        this.puffs.emit(
          v1,
          vel.set(
            Math.cos(a) * speed * 0.5,
            speed * (0.8 + Math.random()),
            Math.sin(a) * speed * 0.5,
          ),
          {
            size: size * 0.7,
            grow: 2.2,
            life: 1.8,
            alpha: 0.55,
            color: COL.spray,
            gravity: 22,
            drag: 0.6,
          },
        );
      else
        this.puffs.emit(
          v1,
          vel.set(Math.cos(a) * speed, 2 + Math.random() * 5, Math.sin(a) * speed),
          {
            size,
            grow: 2.6,
            life: 2.8 + Math.random(),
            alpha: 0.5,
            color: COL.dust,
            drag: 1.1,
            fadeIn: 0.05,
          },
        );
    }
  }

  protected flow(
    body: KaijuBodyView,
    input: VorgasViewInput,
    dt: number,
    water: boolean,
    submerged: boolean,
  ): void {
    if (!body.visible || dt <= 0) return;
    const L = this.look;
    const floor = input.floor;
    const scale = this.spec.puffs / 300;
    // 上陸: 水面のしぶきの輪と、体から落ちる水。上がった後もしばらく滴る
    const rising = submerged || L.wet > 0.6;
    if (rising) {
      this.waterAcc += dt * (submerged ? 70 : 14 * L.wet) * scale;
      while (this.waterAcc >= 1) {
        this.waterAcc -= 1;
        this.nearBody(v1, 16);
        if (submerged && Math.random() < 0.45) {
          // 水面のしぶき（体のまわり）
          const a = Math.random() * Math.PI * 2;
          v1.set(body.feet.x + Math.cos(a) * 30, floor + 2, body.feet.z + Math.sin(a) * 30);
          this.puffs.emit(v1, vel.set(Math.cos(a) * 8, 10 + Math.random() * 14, Math.sin(a) * 8), {
            size: 22,
            grow: 2,
            life: 2,
            alpha: 0.5,
            color: COL.spray,
            gravity: 12,
            drag: 0.5,
          });
        } else if (v1.y > floor + 4) {
          // 体から落ちる水（滝）
          this.puffs.emit(v1, vel.set(0, -6, 0), {
            size: 9 + Math.random() * 8,
            grow: 1.8,
            life: 1.6,
            alpha: 0.4 + 0.2 * L.wet,
            color: COL.spray,
            gravity: 45,
            drag: 0.2,
          });
        }
      }
    }
    // 歩いて水の中を進む: 脚のまわりの波立ち
    if (water && !submerged && Math.hypot(body.velocity.x, body.velocity.z) > 0.5) {
      this.waterAcc += dt * 6 * scale;
      while (this.waterAcc >= 1) {
        this.waterAcc -= 1;
        this.bone(v1, Math.random() < 0.5 ? 'shinL' : 'shinR');
        v1.y = floor + 1;
        this.puffs.emit(v1, randomDir().setY(0.6).multiplyScalar(10), {
          size: 14,
          grow: 2.4,
          life: 1.6,
          alpha: 0.4,
          color: COL.spray,
          gravity: 10,
        });
      }
    }
    // 熱線の溜め: 光の粒を口へ吸い込む・口の光。撃つ間は口の光と湯気
    const mouth = this.bone(v2, 'head', MOUTH);
    if (L.heat > 0.05 && body.attackStep === 'windup') {
      this.chargeAcc += dt * 50 * L.heat * (this.spec.embers / 160);
      while (this.chargeAcc >= 1) {
        this.chargeAcc -= 1;
        const life = 0.5 + Math.random() * 0.3;
        v1.copy(mouth).addScaledVector(randomDir(), 30 + Math.random() * 40);
        this.embers.emit(v1, vel.subVectors(mouth, v1).divideScalar(life), {
          size: 3 + Math.random() * 4,
          grow: 0.4,
          life,
          alpha: 0.9,
          color: COL.charge,
          drag: 0,
          fadeIn: 0.4,
        });
      }
      if (Math.random() < dt * 30)
        this.embers.emit(mouth, vel.set(0, 0, 0), {
          size: 10 + 14 * L.heat,
          grow: 1.2,
          life: 0.18,
          alpha: 0.6 * L.heat,
          color: COL.charge,
        });
    }
    if (body.attack === 'beam' && body.attackStep === 'active') {
      if (Math.random() < dt * 40)
        this.embers.emit(mouth, vel.set(0, 0, 0), {
          size: 26,
          grow: 1.4,
          life: 0.14,
          alpha: 0.7,
          color: 0xcfeaff,
        });
      if (Math.random() < dt * 8 * scale)
        this.puffs.emit(mouth, vel.set(0, 12, 0).addScaledVector(randomDir(), 6), {
          size: 14,
          grow: 2.6,
          life: 1.6,
          alpha: 0.3,
          color: 0xb8bcc0,
        });
    }
    // 亀裂の火の粉（倒すと減って消える。溜めでは多く）
    const live = 1 - L.dead;
    this.emberAcc += dt * (1.5 + 10 * L.heat) * live * (this.spec.embers / 160);
    while (this.emberAcc >= 1) {
      this.emberAcc -= 1;
      this.nearBody(v1, 14);
      if (v1.y < floor + 1) continue;
      this.embers.emit(v1, vel.set(0, 9 + Math.random() * 8, 0).addScaledVector(randomDir(), 4), {
        size: 2 + Math.random() * 2.5,
        grow: 0.6,
        life: 1.6 + Math.random(),
        alpha: 0.85,
        color: COL.ember,
        drag: 0.4,
        fadeIn: 0.1,
      });
    }
    // 薙ぎ払い: 尾の先が地面をこする土煙
    if (
      body.attack === 'sweep' &&
      body.attackStep === 'active' &&
      Math.random() < dt * 25 * scale
    ) {
      this.bone(v1, 'tail4');
      if (v1.y < floor + 30) this.splash(v1, floor, water, 2, 22, 18);
    }
    // 壊した部位の煙
    for (let i = 0; i < 5; i++) {
      if ((this.smokeLeft[i] ?? 0) <= 0) continue;
      this.smokeLeft[i] = Math.max(0, (this.smokeLeft[i] ?? 0) - dt);
      if (Math.random() < dt * 5)
        this.debris.puff(this.bone(v1, PART_BONE[i] ?? 'chest'), vel.set(0, 8, 0), 9);
    }
    // 倒れた後: 煙と湯気がしばらく上がる
    if (
      input.deadTime > V.collapse.fall &&
      input.deadTime < V.collapse.fall + 8 &&
      Math.random() < dt * 6 * scale
    ) {
      this.nearBody(v1, 10);
      this.puffs.emit(v1, vel.set(0, 10, 0), {
        size: 20,
        grow: 2.8,
        life: 3,
        alpha: 0.3,
        color: 0x6a645c,
      });
    }
  }

  dispose(): void {
    this.puffs.dispose();
    this.embers.dispose();
    this.debris.dispose();
  }
}
