// 10-4a: メカ怪獣ゴウライの撃てる物（Three.js 非依存）: 部位の判定の球（胴 2・前の装甲・核・砲台 6・排気口 2）。1 つずつが CombatTarget
// なので、機銃・ミサイル・ロケット・爆弾の当たりとロックは今の仕組みがそのまま動く（アルビオンの albion-target.ts と同じ考え）。
// ダメージは本体（GouraiKaiju.damageSphere）へ渡す。核は開いている間だけ当たる。壊れた砲台・排気口は撃てる物から外す
import { TEAM_ENEMY, type CombatTarget } from '../../combat/target';
import { GOURAI_PARTS, GOURAI_TARGET_SPHERES } from '../../data/gourai';
import { vec3, type Vec3 } from '../../flight/math';
import type { GouraiKaiju } from '../../ai/gourai-ai';

const CORE = GOURAI_PARTS.indexOf('core');

export class GouraiPartTarget implements CombatTarget {
  readonly position: Vec3 = vec3();
  readonly prevPosition: Vec3 = vec3();
  readonly hitRadius: number;
  readonly visualRadius: number;
  readonly team = TEAM_ENEMY;
  /** 大きな的なので狙いの補助を弱める（ネフィルガ・アルビオンと同じ 0.6） */
  readonly assistScale = 0.6;
  /** 範囲ダメージは体の球のうち最も近い 1 つだけ */
  readonly blastGroup: object;
  readonly partIndex: number;
  /** 当てた回数（値の表示） */
  hits = 0;

  constructor(
    private readonly k: GouraiKaiju,
    readonly sphere: number,
  ) {
    const s = GOURAI_TARGET_SPHERES[sphere];
    this.hitRadius = s?.radius ?? 20;
    this.visualRadius = this.hitRadius;
    this.partIndex = GOURAI_PARTS.indexOf(s?.part ?? 'hull');
    this.blastGroup = k;
  }

  get velocity(): Readonly<Vec3> {
    return this.k.body.velocity;
  }

  get active(): boolean {
    const k = this.k;
    if (!k.body.visible || k.parts.dead) return false;
    if (this.partIndex === CORE) return k.coreOpen;
    // 壊れた部位（砲台・排気口）は撃てる物から外す（ロックが移る）。胴・装甲は壊れない
    return !k.parts.isBroken(this.partIndex);
  }

  get hp(): number {
    return this.k.parts.partHp[this.partIndex] ?? 0;
  }

  get maxHp(): number {
    return this.k.parts.partMaxHp[this.partIndex] ?? 0;
  }

  get isDestroyed(): boolean {
    return this.k.parts.dead;
  }

  applyDamage(amount: number): boolean {
    this.hits++;
    return this.k.damageSphere(this.sphere, amount);
  }

  /** 体の位置から置き直す（first は前の位置も同じに） */
  place(first = false): void {
    if (!first) this.beginStep();
    const s = GOURAI_TARGET_SPHERES[this.sphere];
    if (!s) return;
    this.k.body.point(this.position, s);
    if (first) this.beginStep();
  }

  private beginStep(): void {
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.prevPosition.z = this.position.z;
  }
}

export function createGouraiTargets(k: GouraiKaiju): GouraiPartTarget[] {
  return GOURAI_TARGET_SPHERES.map((_, i) => new GouraiPartTarget(k, i));
}
