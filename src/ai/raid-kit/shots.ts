// 10-2: 怪獣の弾（弾幕の機銃・ミサイル。レイドの怪獣の共通の部品）。機銃はまっすぐ、ミサイルは狙う人を追う（1 秒あたりの
// 曲がる角度の上限）。ミサイルはフレアに乗り換える（decoy が向きと距離からフレアの位置を返す。ネフィルガの雷球と同じ考え:
// src/ai/kaiju2-orbs.ts）。当たりは点と半径（自機の当たりの球）。決まった計算・状態は数と配列だけ。Three.js・DOM 非依存
import { vec3, type Vec3 } from '../../flight/math';
import type { ShotKind, ShotOrder } from './barrage';
import { steer } from './minions';

export interface ShotSpec {
  readonly speed: number;
  readonly life: number;
  readonly damage: number;
  /** 当たりの半径（m。自機の当たりの球に足す） */
  readonly radius: number;
  /** 追う速さ（度/秒。機銃は 0） */
  readonly turnDeg: number;
}

export interface Shot {
  active: boolean;
  kind: ShotKind;
  turret: number;
  targetId: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  age: number;
  /** 10-4c: 寿命（秒。撃つときに決める） */
  life: number;
  /** 10-4c: 曲がる秒（0 は曲がらない）と、曲がった後の上下の速さ（m/s） */
  bendAge: number;
  bendVy: number;
  /** フレアに乗り換えた（もう狙う人を追わない） */
  decoyed: boolean;
}

/** 当たった 1 発（呼ぶ側がダメージを入れる） */
export interface ShotHit {
  readonly shot: Readonly<Shot>;
  readonly targetId: number;
  readonly damage: number;
}

export interface ShotVictim {
  readonly id: number;
  readonly position: Readonly<Vec3>;
  readonly radius: number;
}

const DEG = Math.PI / 180;
const want = vec3();

export class ShotPool {
  readonly shots: Shot[];
  /** プールが満杯で撃てなかった数（数値の調整の目安） */
  dropped = 0;

  constructor(
    readonly specs: Readonly<Record<ShotKind, ShotSpec>>,
    capacity: number,
  ) {
    this.shots = Array.from({ length: capacity }, () => ({
      active: false,
      kind: 'gun',
      turret: 0,
      targetId: -1,
      position: vec3(),
      velocity: vec3(),
      age: 0,
      life: 0,
      bendAge: 0,
      bendVy: 0,
      decoyed: false,
    }));
  }

  get activeCount(): number {
    let n = 0;
    for (const s of this.shots) if (s.active) n++;
    return n;
  }

  /** 撃つ（Barrage.step の fire に渡す）。満杯なら撃たない */
  readonly fire = (o: ShotOrder): void => {
    const s = this.shots.find((x) => !x.active);
    if (!s) {
      this.dropped++;
      return;
    }
    const spec = this.specs[o.weapon];
    s.active = true;
    s.kind = o.weapon;
    s.turret = o.turret;
    s.targetId = o.targetId;
    s.position.x = o.origin.x;
    s.position.y = o.origin.y;
    s.position.z = o.origin.z;
    s.velocity.x = o.direction.x * spec.speed;
    s.velocity.y = o.direction.y * spec.speed;
    s.velocity.z = o.direction.z * spec.speed;
    s.age = 0;
    s.life = o.life ?? spec.life;
    s.bendAge = o.bendAge ?? 0;
    s.bendVy = o.bendVy ?? 0;
    s.decoyed = false;
  };

  /**
   * 1 ステップ: 進める・ミサイルは追う・当たりを調べる。当たった弾は消して onHit に渡す。
   * targetOf は狙う人の位置（いなければ null）、decoy は向きの先のフレア（無ければ null）
   */
  step(
    dt: number,
    victims: readonly ShotVictim[],
    targetOf: (id: number) => Readonly<Vec3> | null,
    onHit: (hit: ShotHit) => void,
    decoy: (from: Readonly<Vec3>, dir: Readonly<Vec3>) => Readonly<Vec3> | null = () => null,
  ): void {
    for (const s of this.shots) {
      if (!s.active) continue;
      const spec = this.specs[s.kind];
      s.age += dt;
      if (s.age >= s.life) {
        s.active = false;
        continue;
      }
      if (spec.turnDeg > 0) this.home(s, spec, dt, targetOf, decoy);
      if (s.bendAge > 0 && s.age >= s.bendAge) {
        s.velocity.y = s.bendVy;
        s.bendAge = 0;
      }
      const px = s.position.x;
      const py = s.position.y;
      const pz = s.position.z;
      s.position.x += s.velocity.x * dt;
      s.position.y += s.velocity.y * dt;
      s.position.z += s.velocity.z * dt;
      for (const v of victims) {
        if (!sweptHit(px, py, pz, s.position, v.position, v.radius + spec.radius)) continue;
        s.active = false;
        onHit({ shot: s, targetId: v.id, damage: spec.damage });
        break;
      }
    }
  }

  private home(
    s: Shot,
    spec: ShotSpec,
    dt: number,
    targetOf: (id: number) => Readonly<Vec3> | null,
    decoy: (from: Readonly<Vec3>, dir: Readonly<Vec3>) => Readonly<Vec3> | null,
  ): void {
    const len = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z) || 1;
    want.x = s.velocity.x / len;
    want.y = s.velocity.y / len;
    want.z = s.velocity.z / len;
    const flare = decoy(s.position, want);
    if (flare) s.decoyed = true;
    const goal = flare ?? (s.decoyed ? null : targetOf(s.targetId));
    if (!goal) return;
    want.x = goal.x - s.position.x;
    want.y = goal.y - s.position.y;
    want.z = goal.z - s.position.z;
    steer(s.velocity, want, spec.speed, spec.turnDeg * DEG * dt);
  }

  clear(): void {
    for (const s of this.shots) s.active = false;
  }
}

/** 前の位置 (px, py, pz) から今の位置 p までの線分が、c を中心の半径 r の球に触れたか（速い弾のすり抜けを防ぐ） */
function sweptHit(
  px: number,
  py: number,
  pz: number,
  p: Readonly<Vec3>,
  c: Readonly<Vec3>,
  r: number,
): boolean {
  const dx = p.x - px;
  const dy = p.y - py;
  const dz = p.z - pz;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((c.x - px) * dx + (c.y - py) * dy + (c.z - pz) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = px + dx * t - c.x;
  const y = py + dy * t - c.y;
  const z = pz + dz * t - c.z;
  return x * x + y * y + z * z <= r * r;
}
