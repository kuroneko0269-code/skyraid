// 9-6b: ネフィルガの撃てる部位（胴・左右の翼・頭・尾。Three.js 非依存）。1 つずつが CombatTarget で、機銃・ミサイル・ロケット・
// 爆弾の当たりとロック・Tab の切り替えは今の仕組みがそのまま部位単位で動く（ヴォルガスの kaiju-part.ts と同じ考え）。
// 位置は体の位置・向き・傾き・翼のたたみ具合から毎ステップ置き直す。ダメージは持ち主（kaiju2-raid.ts）へ渡す
import { TEAM_ENEMY, type CombatTarget } from '../../combat/target';
import {
  KAIJU2_RAID_CONFIG,
  KAIJU2_TARGETS,
  type Kaiju2Target as TargetId,
} from '../../data/kaiju2-raid';
import { vec3, type Vec3 } from '../../flight/math';
import type { SkyKaiju } from './sky-kaiju';

/** 部位のダメージの受け口 */
export interface Kaiju2TargetOwner {
  readonly targetable: boolean;
  readonly isDestroyed: boolean;
  readonly velocity: Readonly<Vec3>;
  /** この被弾で倒れたら true。attacker は協力のプレイヤー ID（ソロは 0。9-6c） */
  damageTarget(target: Kaiju2PartTarget, amount: number, attacker?: number): boolean;
}

export class Kaiju2PartTarget implements CombatTarget {
  readonly position: Vec3 = vec3();
  readonly prevPosition: Vec3 = vec3();
  readonly hitRadius: number;
  readonly visualRadius: number;
  readonly team = TEAM_ENEMY;
  /** 範囲ダメージは体の部位のうち最も近い 1 つだけ（combat/target.ts の nearestPerGroup） */
  readonly blastGroup: object;
  /** 部位 HP（戻らない。胴は Infinity = 壊れない） */
  partHp = Infinity;
  partMaxHp = Infinity;

  constructor(
    readonly id: TargetId,
    private readonly owner: Kaiju2TargetOwner,
  ) {
    const spec = KAIJU2_RAID_CONFIG.targets[id];
    this.hitRadius = spec.radius;
    this.visualRadius = spec.radius;
    this.blastGroup = owner;
  }

  get velocity(): Readonly<Vec3> {
    return this.owner.velocity;
  }

  get active(): boolean {
    return this.owner.targetable;
  }

  get broken(): boolean {
    return this.partHp <= 0;
  }

  get hp(): number {
    return this.partHp;
  }

  get maxHp(): number {
    return this.partMaxHp;
  }

  get isDestroyed(): boolean {
    return this.owner.isDestroyed;
  }

  applyDamage(amount: number): boolean {
    return this.owner.damageTarget(this, amount);
  }

  /** 9-6c: 部位の番号（KAIJU2_TARGETS の順。協力の入力の targetId = KAIJU_ID_BASE + これ） */
  get kaijuIndex(): number {
    return KAIJU2_TARGETS.indexOf(this.id);
  }

  /** 9-6c: 協力（ホスト）: 攻撃した人の ID 付き */
  damageBy(amount: number, attacker: number): boolean {
    return this.owner.damageTarget(this, amount, attacker);
  }

  reset(maxHp: number): void {
    this.partMaxHp = maxHp > 0 ? Math.max(1, Math.round(maxHp)) : Infinity;
    this.partHp = this.partMaxHp;
  }

  /** 体の姿勢から位置を置き直す（first は前の位置も同じにする: 出した直後） */
  place(k: SkyKaiju, first = false): void {
    const spec = KAIJU2_RAID_CONFIG.targets[this.id];
    const f = k.pose.wingFold;
    const ox = spec.open[0] + (spec.folded[0] - spec.open[0]) * f;
    const oy = spec.open[1] + (spec.folded[1] - spec.open[1]) * f;
    const oz = spec.open[2] + (spec.folded[2] - spec.open[2]) * f;
    bodyToWorld(k, ox, oy, oz, this.position);
    if (first) {
      this.prevPosition.x = this.position.x;
      this.prevPosition.y = this.position.y;
      this.prevPosition.z = this.position.z;
    }
  }

  /** ステップの初めに前の位置を写す */
  beginStep(): void {
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.prevPosition.z = this.position.z;
  }
}

/**
 * 体の座標（右 +x・上 +y・前 −z）→ ワールド。向きは forward、右は forward × 上、傾き（bank。正で右翼が下がる）で
 * 右と上を前の軸のまわりに回す（描画の kaiju2-object.ts と同じ向き）
 */
export function bodyToWorld(k: SkyKaiju, x: number, y: number, z: number, out: Vec3): Vec3 {
  const f = k.forward;
  // 右 = f × (0,1,0)
  let rx = -f.z;
  let rz = f.x;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-6) {
    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  // 上 = 右 × 前
  const ux = -rz * f.y;
  const uy = rz * f.x - rx * f.z;
  const uz = rx * f.y;
  const c = Math.cos(k.bank);
  const s = Math.sin(k.bank);
  // 傾き: 右翼が下がる向き（右を下へ、上を右へ）
  const r2x = rx * c - ux * s;
  const r2y = -uy * s;
  const r2z = rz * c - uz * s;
  const u2x = ux * c + rx * s;
  const u2y = uy * c;
  const u2z = uz * c + rz * s;
  const p = k.position;
  // 前 −z: 体の z が負なら前
  out.x = p.x + r2x * x + u2x * y - f.x * z;
  out.y = p.y + r2y * x + u2y * y - f.y * z;
  out.z = p.z + r2z * x + u2z * y - f.z * z;
  return out;
}
