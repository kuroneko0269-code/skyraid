// 10-3a: 白鯨アルビオンの撃てる物（Three.js 非依存）: 部位の判定の球（胴 3・腹の巣 3・背びれ・尾・頭）と子分 1 匹ずつ。
// 1 つずつが CombatTarget なので、機銃・ミサイル・ロケット・爆弾の当たりとロックは今の仕組みがそのまま動く（ネフィルガの
// kaiju2-target.ts と同じ考え）。ダメージは本体（AlbionKaiju の PartSet・MinionSwarm）へ渡す。位置は毎ステップ置き直す
import { TEAM_ENEMY, type CombatTarget } from '../../combat/target';
import { ALBION_MINION_RADIUS, ALBION_PARTS, ALBION_TARGET_SPHERES } from '../../data/albion';
import { vec3, type Vec3 } from '../../flight/math';
import type { AlbionKaiju } from '../../ai/albion-ai';

/**
 * 10-3b: ダメージの行き先（レイドの AlbionRaid: 被弾の光・撃破。攻撃した人の ID 付き）。部位・子分の当たりはここへ渡す
 */
export interface AlbionDamageSink {
  readonly kaiju: AlbionKaiju;
  readonly targetable: boolean;
  damagePart(index: number, amount: number, attacker?: number): boolean;
  damageMinion(index: number, amount: number, attacker?: number): boolean;
}

/** 部位の判定の球 */
export class AlbionPartTarget implements CombatTarget {
  readonly position: Vec3 = vec3();
  readonly prevPosition: Vec3 = vec3();
  readonly hitRadius: number;
  readonly visualRadius: number;
  readonly team = TEAM_ENEMY;
  /** 大きな的なので狙いの補助を弱める（ネフィルガと同じ 0.6） */
  readonly assistScale = 0.6;
  /** 範囲ダメージは体の球のうち最も近い 1 つだけ */
  readonly blastGroup: object;
  readonly partIndex: number;
  /** 当てた回数（値の表示） */
  hits = 0;
  private readonly k: AlbionKaiju;

  constructor(
    private readonly sink: AlbionDamageSink,
    readonly sphere: number,
  ) {
    const k = sink.kaiju;
    this.k = k;
    const s = ALBION_TARGET_SPHERES[sphere];
    this.hitRadius = s?.radius ?? 30;
    this.visualRadius = this.hitRadius;
    this.partIndex = ALBION_PARTS.indexOf(s?.part ?? 'body');
    this.blastGroup = k;
  }

  get velocity(): Readonly<Vec3> {
    return this.k.body.velocity;
  }

  get active(): boolean {
    return this.sink.targetable && !this.k.parts.dead;
  }

  /** 10-3b: 協力の部位の番号（入力の targetId は KAIJU_ID_BASE + これ。判定の球の番号） */
  get kaijuIndex(): number {
    return this.sphere;
  }

  /** 部位の名前（ALBION_PARTS） */
  get id(): string {
    return ALBION_PARTS[this.partIndex] ?? 'body';
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

  /** 攻撃した人の ID 付き（協力の PvpArena の部位） */
  damageBy(amount: number, attacker: number): boolean {
    this.hits++;
    return this.sink.damagePart(this.partIndex, amount, attacker);
  }

  /** 体の位置から置き直す（first は前の位置も同じに） */
  place(first = false): void {
    if (!first) this.beginStep();
    const s = ALBION_TARGET_SPHERES[this.sphere];
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

/** 子分 1 匹（MinionSwarm のプールの番号） */
export class AlbionMinionTarget implements CombatTarget {
  readonly prevPosition: Vec3 = vec3();
  readonly hitRadius = ALBION_MINION_RADIUS;
  readonly visualRadius = ALBION_MINION_RADIUS;
  readonly team = TEAM_ENEMY;
  readonly maxHp: number;
  /** 10-3b: 子分の印（勲章の撃墜の種類 'minion'。src/missions/badges/kill-kind.ts） */
  readonly raidMinion = true;
  private readonly k: AlbionKaiju;

  constructor(
    private readonly sink: AlbionDamageSink,
    readonly index: number,
  ) {
    this.k = sink.kaiju;
    this.maxHp = this.k.swarm.spec.hp;
  }

  private get minion() {
    return this.k.swarm.minions[this.index];
  }

  get position(): Readonly<Vec3> {
    return this.minion?.position ?? this.prevPosition;
  }

  get velocity(): Readonly<Vec3> {
    return this.minion?.velocity ?? this.prevPosition;
  }

  get active(): boolean {
    return this.sink.targetable && this.minion?.active === true;
  }

  get hp(): number {
    return this.minion?.active ? this.minion.hp : 0;
  }

  get isDestroyed(): boolean {
    return !this.active;
  }

  applyDamage(amount: number): boolean {
    return this.damageBy(amount, 0);
  }

  /** 攻撃した人の ID 付き（協力） */
  damageBy(amount: number, attacker: number): boolean {
    return this.sink.damageMinion(this.index, amount, attacker);
  }

  /** ステップの初めに前の位置を写す */
  beginStep(): void {
    const m = this.minion;
    if (!m) return;
    this.prevPosition.x = m.position.x;
    this.prevPosition.y = m.position.y;
    this.prevPosition.z = m.position.z;
  }
}

/** 撃てる物を全部作る（部位の球の後に子分） */
export function createAlbionTargets(sink: AlbionDamageSink): {
  parts: AlbionPartTarget[];
  minions: AlbionMinionTarget[];
} {
  return {
    parts: ALBION_TARGET_SPHERES.map((_, i) => new AlbionPartTarget(sink, i)),
    minions: sink.kaiju.swarm.minions.map((_, i) => new AlbionMinionTarget(sink, i)),
  };
}
