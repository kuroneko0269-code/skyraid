// 10-7b: 白鯨アルビオンの柔らかい粒の出し方（描画だけ。albion-effects.ts から分けた）: 登場の雲の塊・体に沿って流れる雲と
// 遠くの雲のちぎれ・潮吹きのしぶきと霧・雲を吐く前の霧・撃破で海へ落ちたときの水柱としぶきの輪。粒は共通の kaiju-look/puffs.ts。
// 乱数は Math.random（見た目だけ）
import { Color, Vector3 } from 'three';
import { ALBION_VISUAL, type AlbionTierSpec } from '../../data/albion-visual';
import type { AlbionKaiju } from '../../ai/albion-ai';
import type { KaijuPuffs } from '../kaiju-look/puffs';

const V = ALBION_VISUAL;

/** 体の座標の点（静止姿勢: 右 +X・上 +Y・前 −Z） */
export const P = {
  blowhole: new Vector3(0, 60, -210),
  head: new Vector3(0, 0, -290),
  mouth: new Vector3(0, -24, -300),
  finTipL: new Vector3(-165, -58, -74),
  finTipR: new Vector3(165, -58, -74),
  flukeL: new Vector3(-105, 2, 328),
  flukeR: new Vector3(105, 2, 328),
  dorsal: new Vector3(0, 66, 40),
  tail: new Vector3(0, 0, 300),
} as const;
/** 胴の半径（頭の先 → 尾の先。z と半径） */
const RADIUS: readonly (readonly [number, number])[] = [
  [-321, 3],
  [-300, 38],
  [-250, 54],
  [-140, 60],
  [-60, 58],
  [10, 54],
  [70, 46],
  [130, 36],
  [190, 25],
  [240, 17],
  [300, 5],
];

export function radiusAt(z: number): number {
  for (let i = 0; i < RADIUS.length - 1; i++) {
    const a = RADIUS[i];
    const b = RADIUS[i + 1];
    if (a && b && z <= b[0]) return a[1] + ((b[1] - a[1]) * (z - a[0])) / (b[0] - a[0]);
  }
  return 4;
}

const v1 = new Vector3();
const v2 = new Vector3();
const local = new Vector3();
const drift = new Vector3();

/** 体の座標の点をワールドへ（骨の名前は root・finL・finR・flukes） */
export type BodyPoint = (
  out: Vector3,
  p: Readonly<Vector3>,
  bone?: 'root' | 'finL' | 'finR' | 'flukes',
) => Vector3;

export class AlbionPuffFx {
  /** 雲の色（空と日の色から。毎フレーム albion-effects.ts が入れる）・体の速さ（ワールド） */
  readonly cloud = new Color();
  readonly vel = new Vector3();
  private wispAcc = 0;
  private sprayAcc = 0;
  private puffAcc = 0;
  private splashLeft = 0;
  /** 撃破の水柱の中心（海面） */
  private readonly splashAt = new Vector3();

  constructor(
    private readonly spec: AlbionTierSpec,
    private readonly puffs: KaijuPuffs,
    private readonly at: BodyPoint,
  ) {}

  reset(): void {
    this.splashLeft = 0;
  }

  /** 登場の場面の始め: 体の前の半分を雲の塊で包む（頭が押し分けて出てくる） */
  cloudBank(forward: Readonly<Vector3>): void {
    const n = Math.min(70, Math.floor(this.spec.puffs * 0.45));
    for (let i = 0; i < n; i++) {
      const z = -380 + Math.random() * 520;
      const a = Math.random() * Math.PI * 2;
      const r = radiusAt(Math.max(-320, Math.min(300, z))) * (1.1 + Math.random() * 1.6) + 30;
      local.set(Math.cos(a) * r, Math.sin(a) * r * 0.8, z);
      this.at(v1, local);
      // 後ろへ流れる（体が雲を押し分けて進んで見える）・外へ散る
      v2.copy(forward).multiplyScalar(-(40 + Math.random() * 30));
      v2.x += (Math.random() - 0.5) * 20;
      v2.y += (Math.random() - 0.3) * 10;
      v2.z += (Math.random() - 0.5) * 20;
      this.puffs.emit(v1, v2, {
        size: 120 + Math.random() * 140,
        grow: 1.5,
        life: 3.5 + Math.random() * 2.5,
        alpha: 0.75,
        color: this.cloud,
        drag: 0.1,
        fadeIn: 0,
      });
    }
  }

  /** 体に沿って流れる雲（体の前の方の表面の少し外に置く。体が進むので後ろへ流れて見える）と遠くの雲のちぎれ */
  wisps(k: AlbionKaiju, dt: number, dead: boolean): void {
    if (this.spec.wispEvery <= 0 || dead || !k.body.visible) return;
    this.wispAcc += dt;
    while (this.wispAcc >= this.spec.wispEvery) {
      this.wispAcc -= this.spec.wispEvery;
      this.wisp(0, null);
    }
  }

  /** 前から出ていたことにする（寿命の間に出た分を、体が進んだ分だけ後ろへずらして置く） */
  warmWisps(k: AlbionKaiju, forward: Readonly<Vector3>): void {
    if (this.spec.wispEvery <= 0 || !k.body.visible) return;
    const life = V.wisps.life;
    for (let age = this.spec.wispEvery; age < life * 0.9; age += this.spec.wispEvery)
      this.wisp(age, v2.copy(forward).multiplyScalar(-k.body.speed * age));
  }

  /** 雲を 1 つ（age 秒前に出た。shift はそのぶん後ろへずらす量） */
  private wisp(age: number, shift: Readonly<Vector3> | null): void {
    const W = V.wisps;
    const far = Math.random() < 0.25;
    const z = -300 + Math.random() * (far ? 600 : 380);
    const a = Math.random() * Math.PI * 2;
    const r = radiusAt(z) * (far ? 1.8 + Math.random() * 2.2 : W.standoff + Math.random() * 0.25);
    local.set(Math.cos(a) * r, Math.sin(a) * r, z);
    this.at(v1, local);
    if (shift) v1.add(shift);
    drift.set((Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4);
    this.puffs.emit(v1, drift, {
      size: W.size * (far ? 1.6 + Math.random() : 0.6 + Math.random() * 0.8),
      grow: 1.6,
      life: W.life * (0.7 + Math.random() * 0.5),
      alpha: W.alpha * (far ? 0.8 : 1),
      color: this.cloud,
      drag: 0.05,
      fadeIn: 0.25,
      age,
    });
  }

  /** 潮吹き: 予兆は噴気孔から霧が漏れ、攻撃でしぶきが噴き上がって霧が広がる */
  spout(k: AlbionKaiju, dt: number): void {
    const S = V.spout;
    const active = k.attack === 'spout' && k.action === 'active';
    const swell = k.body.pose.spoutSwell;
    const rate = active ? S.rate : swell * 6;
    if (rate <= 0) return;
    this.sprayAcc += rate * dt;
    this.at(v1, P.blowhole);
    while (this.sprayAcc >= 1) {
      this.sprayAcc -= 1;
      if (active) {
        const up = S.speed * (0.55 + Math.random() * 0.45);
        v2.set((Math.random() - 0.5) * 30, up, (Math.random() - 0.5) * 30).addScaledVector(
          this.vel,
          0.5,
        );
        this.puffs.emit(v1, v2, {
          size: 22 + Math.random() * 26,
          grow: 2.8,
          life: 2.8 + Math.random(),
          alpha: 0.45,
          color: V.colors.spray,
          gravity: 55,
          drag: 0.35,
          fadeIn: 0.02,
        });
        if (Math.random() < 0.45) {
          v2.set((Math.random() - 0.5) * 20, up * 0.5, (Math.random() - 0.5) * 20).addScaledVector(
            this.vel,
            0.6,
          );
          this.puffs.emit(v1, v2, {
            size: S.mist * (0.7 + Math.random() * 0.6),
            grow: 3,
            life: 4.5 + Math.random() * 2,
            alpha: 0.28,
            color: this.cloud,
            gravity: 4,
            drag: 0.6,
            fadeIn: 0.1,
          });
        }
      } else {
        v2.set(
          (Math.random() - 0.5) * 6,
          8 + Math.random() * 6,
          (Math.random() - 0.5) * 6,
        ).addScaledVector(this.vel, 0.8);
        this.puffs.emit(v1, v2, {
          size: 12 + Math.random() * 8,
          grow: 2,
          life: 2 + Math.random(),
          alpha: 0.3 * swell,
          color: V.colors.spray,
          drag: 0.5,
          fadeIn: 0.1,
        });
      }
    }
  }

  /** 雲を吐く予兆: 口のまわりに霧が渦を巻く */
  mist(k: AlbionKaiju, dt: number): void {
    const m = k.body.pose.mist;
    if (m <= 0.05) return;
    this.puffAcc += dt * 14 * m;
    while (this.puffAcc >= 1) {
      this.puffAcc -= 1;
      const a = Math.random() * Math.PI * 2;
      local.set(Math.cos(a) * 60, Math.sin(a) * 45 - 10, -300 - Math.random() * 40);
      this.at(v1, local);
      v2.set(-Math.sin(a) * 30, Math.cos(a) * 20, 0).addScaledVector(this.vel, 0.8);
      this.puffs.emit(v1, v2, {
        size: 50 + Math.random() * 40,
        grow: 2.2,
        life: 3 + Math.random(),
        alpha: 0.35 * m,
        color: this.cloud,
        drag: 0.4,
        fadeIn: 0.2,
      });
    }
  }

  /** 撃破で海へ落ちた: 大きな水柱と、海面を広がるしぶきの輪 */
  startSplash(center: Readonly<Vector3>, k: AlbionKaiju): void {
    this.splashAt.set(center.x, k.body.floorAt(center.x, center.z), center.z);
    this.splashLeft = 1.4;
    const S = V.splash;
    const n = Math.min(S.count, Math.floor(this.spec.puffs * 0.4));
    const g = 45;
    const up = Math.sqrt(2 * g * S.height);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * S.spread * 0.6;
      v1.set(
        this.splashAt.x + Math.cos(a) * r,
        this.splashAt.y + 5,
        this.splashAt.z + Math.sin(a) * r,
      );
      const ring = i % 3 === 0;
      v2.set(Math.cos(a), 0, Math.sin(a)).multiplyScalar(
        ring ? 70 + Math.random() * 40 : 10 + Math.random() * 25,
      );
      v2.y = ring ? 10 + Math.random() * 15 : up * (0.45 + Math.random() * 0.55);
      this.puffs.emit(v1, v2, {
        size: ring ? 60 + Math.random() * 50 : 50 + Math.random() * 60,
        grow: 3,
        life: ring ? 4 + Math.random() * 2 : 6 + Math.random() * 3,
        alpha: 0.7,
        color: V.colors.splash,
        gravity: ring ? 6 : g,
        drag: ring ? 0.6 : 0.15,
        fadeIn: 0.02,
      });
    }
  }

  /** 水柱の間（しばらく霧を足す） */
  splash(dt: number): void {
    if (this.splashLeft <= 0) return;
    this.splashLeft -= dt;
    if (Math.random() > dt * 20) return;
    const a = Math.random() * Math.PI * 2;
    v1.set(
      this.splashAt.x + Math.cos(a) * 80,
      this.splashAt.y + 20,
      this.splashAt.z + Math.sin(a) * 80,
    );
    v2.set(Math.cos(a) * 20, 60 + Math.random() * 60, Math.sin(a) * 20);
    this.puffs.emit(v1, v2, {
      size: 90 + Math.random() * 60,
      grow: 2.5,
      life: 6,
      alpha: 0.35,
      color: this.cloud,
      gravity: 8,
      drag: 0.4,
      fadeIn: 0.2,
    });
  }

  /** 部位を壊した: 巣は赤い霧が下へ噴き出す（巣が裂ける）、ほかは煙 */
  partBurst(at: Readonly<Vector3>, v: Readonly<Vector3>, nest: boolean): void {
    // 巣が裂ける: 赤い霧が下へ噴き出す
    const n = nest ? Math.min(26, this.spec.puffs >> 3) : Math.min(14, this.spec.puffs >> 4);
    for (let i = 0; i < n; i++) {
      v2.set(
        (Math.random() - 0.5) * 50,
        nest ? -30 - Math.random() * 40 : Math.random() * 30,
        (Math.random() - 0.5) * 50,
      ).add(v);
      this.puffs.emit(at, v2, {
        size: nest ? 22 + Math.random() * 20 : 30 + Math.random() * 25,
        grow: 2.6,
        life: 2.5 + Math.random() * 2,
        alpha: nest ? 0.6 : 0.45,
        color: nest ? V.colors.nestMist : V.debris.smokeColor,
        gravity: nest ? 8 : 0,
        drag: 0.8,
        fadeIn: 0.05,
      });
    }
  }

  /** 尾びれが打ち返したとき: 尾びれの先に渦の霧（打った向きと逆へゆっくり流れる） */
  vortex(at: Readonly<Vector3>, sign: number): void {
    for (let i = 0; i < 3; i++) {
      v2.set((Math.random() - 0.5) * 8, -sign * (6 + Math.random() * 6), (Math.random() - 0.5) * 8);
      this.puffs.emit(at, v2, {
        size: 26 + Math.random() * 20,
        grow: 2.6,
        life: 3 + Math.random() * 1.5,
        alpha: 0.32,
        color: this.cloud,
        drag: 0.5,
        fadeIn: 0.1,
      });
    }
  }
}

/** 骨の静止姿勢の位置（体の座標。skeleton.ts の BONE_DEFS と同じ） */
export const REST = {
  root: new Vector3(0, 0, 0),
  finL: new Vector3(-40, -32, -125),
  finR: new Vector3(40, -32, -125),
  flukes: new Vector3(0, 0, 280),
} as const;
