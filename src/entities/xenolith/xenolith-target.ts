// 10-5a: UFO ゼノリスの撃てる物（Three.js 非依存）: 部位の判定の球（胴 7・ドーム・砲口・縁の発光体 4・下の発生器 3）。1 つずつが
// CombatTarget なので、機銃・ミサイル・ロケット・爆弾の当たりとロックは今の仕組みがそのまま動く（ゴウライの gourai-target.ts と同じ考え）。
// ダメージは本体（XenolithKaiju.damageSphere）へ渡す。バリアを張っている間は殻の中の部位に当たっても効かない（弾は消える = 止められた）。
// 壊れた部位（発光体・発生器・砲口）は撃てる物から外す。縁の発光体は回る輪に付いて動く
import { TEAM_ENEMY, type CombatTarget } from '../../combat/target';
import { XENOLITH_PARTS, XENOLITH_TARGET_SPHERES } from '../../data/xenolith';
import { vec3, type Vec3 } from '../../flight/math';
import { xenolithSpherePoint, type XenolithKaiju } from '../../ai/xenolith-ai';

/** 撃てる物が読む本体（10-5b のレイドの進め方でも同じ形） */
export interface XenolithDamageHost {
  readonly kaiju: XenolithKaiju;
  damageSphere(sphere: number, amount: number, attacker?: number): boolean;
}

const DOME = XENOLITH_PARTS.indexOf('dome');

export class XenolithPartTarget implements CombatTarget {
  readonly position: Vec3 = vec3();
  readonly prevPosition: Vec3 = vec3();
  readonly velocity: Vec3 = vec3();
  readonly hitRadius: number;
  readonly visualRadius: number;
  readonly team = TEAM_ENEMY;
  /** 小さく速い的なので、狙いの補助はほかの怪獣（0.6）より少し強め（10-5b で 0.8 のまま決めた） */
  readonly assistScale = 0.8;
  /** 範囲ダメージは体の球のうち最も近い 1 つだけ */
  readonly blastGroup: object;
  readonly partIndex: number;
  /** 当てた回数（値の表示） */
  hits = 0;

  private readonly k: XenolithKaiju;

  constructor(
    private readonly host: XenolithDamageHost,
    readonly sphere: number,
  ) {
    const k = host.kaiju;
    this.k = k;
    const s = XENOLITH_TARGET_SPHERES[sphere];
    this.hitRadius = s?.radius ?? 20;
    this.visualRadius = this.hitRadius;
    this.partIndex = XENOLITH_PARTS.indexOf(s?.part ?? 'hull');
    this.blastGroup = k;
  }

  get active(): boolean {
    const k = this.k;
    if (!k.body.visible || k.parts.dead) return false;
    // 壊れたドームは胴として当たり続ける（中身が見える）。ほかの壊れた部位は外す（ロックが移る）
    if (this.partIndex === DOME) return true;
    return !k.parts.isBroken(this.partIndex);
  }

  /** 10-5b: 協力の部位の番号（入力の targetId は KAIJU_ID_BASE + これ。判定の球の番号） */
  get kaijuIndex(): number {
    return this.sphere;
  }

  get id(): string {
    return XENOLITH_PARTS[this.partIndex] ?? 'hull';
  }

  get broken(): boolean {
    return this.k.parts.isBroken(this.partIndex);
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
    return this.damageBy(amount, 0);
  }

  damageBy(amount: number, attacker: number): boolean {
    this.hits++;
    return this.host.damageSphere(this.sphere, amount, attacker);
  }

  /** 体の位置から置き直す（first は前の位置も同じに。瞬間移動した後も同じ: 間を通る線を作らない） */
  place(first = false, dt = 1 / 60): void {
    const warped = first || this.k.body.warped;
    if (!warped) this.copyPrev();
    xenolithSpherePoint(this.position, this.k.body, this.sphere);
    if (warped) {
      this.copyPrev();
      this.velocity.x = 0;
      this.velocity.y = 0;
      this.velocity.z = 0;
      return;
    }
    // 速度は前の位置との差（回る輪の発光体も正しく見越せる）
    this.velocity.x = (this.position.x - this.prevPosition.x) / dt;
    this.velocity.y = (this.position.y - this.prevPosition.y) / dt;
    this.velocity.z = (this.position.z - this.prevPosition.z) / dt;
  }

  private copyPrev(): void {
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.prevPosition.z = this.position.z;
  }
}

export function createXenolithTargets(host: XenolithDamageHost): XenolithPartTarget[] {
  return XENOLITH_TARGET_SPHERES.map((_, i) => new XenolithPartTarget(host, i));
}
