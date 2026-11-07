// 10-2: 部位と破壊（レイドの怪獣の共通の部品）。部位ごとの HP（全体 HP の割合）・攻撃した人ごとの与ダメージ・壊れた部位の
// 効き目（使えなくなる攻撃・動きの倍率）。ネフィルガ（9-6b）の「部位を壊すと動きが変わる」（翼で速さ ×0.8・頭で雷球なし）と
// 同じ考えを、怪獣のデータ（PartSpec）だけで書けるようにした。決まった計算・状態は数と配列だけ（frame.ts の断り）
// 人数の補正（8-6c / 9-6c の部位ダメージの倍率）は呼ぶ側が amount に掛けてから渡す。Three.js・DOM 非依存

/** 壊れたときの効き目 */
export interface PartEffects {
  /** 使えなくなる攻撃・行動の名前（怪獣ごとに決める。例 'spout'・'turretL'・'warp'） */
  readonly disable?: readonly string[];
  /** 掛ける倍率（例 { speed: 0.8, turn: 0.85 }。壊れた部位の分を掛け合わせる） */
  readonly mul?: Readonly<Record<string, number>>;
}

export interface PartSpec {
  readonly id: string;
  /** 部位 HP = 全体の最大 HP × この割合 */
  readonly hpShare: number;
  /** 壊せるか（胴のように壊れない部位は false。HP は全体に効くだけ） */
  readonly breakable: boolean;
  /** 部位に当てたダメージのうち全体の HP に効く割合（1 = そのまま。弱点は 1 より大きく、装甲は小さく） */
  readonly bodyFactor?: number;
  readonly effects?: PartEffects;
}

/** 攻撃した人の数の上限（協力は 4 人。PlayerInfo.id は 0〜7 の範囲） */
const ATTACKERS = 8;

export interface PartHit {
  /** 全体の HP に効いた量 */
  readonly body: number;
  /** この被弾で部位が壊れた */
  readonly broke: boolean;
  /** この被弾で全体の HP が 0 になった */
  readonly killed: boolean;
}

export class PartSet {
  maxHp: number;
  hp: number;
  readonly partMaxHp: number[];
  readonly partHp: number[];
  /** 壊れた順の記録（部位の番号）。壊れたビットは brokenMask */
  readonly brokenOrder: number[] = [];
  /** 攻撃した人 × 部位の与ダメージ（成績の partDamage） */
  readonly damageBy: number[][];
  /** 攻撃した人ごとの部位を壊した数（成績の breaks） */
  readonly breaksBy: number[];

  constructor(
    readonly specs: readonly PartSpec[],
    maxHp: number,
  ) {
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.partMaxHp = specs.map((s) => maxHp * s.hpShare);
    this.partHp = [...this.partMaxHp];
    this.damageBy = Array.from({ length: ATTACKERS }, () => specs.map(() => 0));
    this.breaksBy = Array.from({ length: ATTACKERS }, () => 0);
  }

  /** 10-3b: 最大 HP を変える（難易度・協力の人数の倍率。部位 HP も同じ割合で作り直し、満タンにする） */
  setMaxHp(maxHp: number): void {
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.specs.forEach((s, i) => {
      this.partMaxHp[i] = maxHp * s.hpShare;
      this.partHp[i] = maxHp * s.hpShare;
    });
  }

  get count(): number {
    return this.specs.length;
  }

  get dead(): boolean {
    return this.hp <= 0;
  }

  /** 体力の割合（0〜1） */
  get ratio(): number {
    return this.maxHp > 0 ? Math.max(0, this.hp) / this.maxHp : 0;
  }

  isBroken(index: number): boolean {
    const spec = this.specs[index];
    return spec !== undefined && spec.breakable && (this.partHp[index] ?? 1) <= 0;
  }

  /** 壊れた部位のビット（specs の順。協力の state・HUD） */
  get brokenMask(): number {
    let m = 0;
    for (let i = 0; i < this.specs.length; i++) if (this.isBroken(i)) m |= 1 << i;
    return m;
  }

  indexOf(id: string): number {
    return this.specs.findIndex((s) => s.id === id);
  }

  /** 部位に当てる（attacker はプレイヤー ID。ソロは 0）。倒れた後・知らない部位は何も起きない */
  damage(index: number, amount: number, attacker: number): PartHit {
    const spec = this.specs[index];
    if (!spec || this.dead || amount <= 0) return NO_HIT;
    const who = Math.min(ATTACKERS - 1, Math.max(0, Math.floor(attacker)));
    const row = this.damageBy[who];
    if (row) row[index] = (row[index] ?? 0) + amount;
    let broke = false;
    const before = this.partHp[index] ?? 0;
    if (spec.breakable && before > 0) {
      const after = before - amount;
      this.partHp[index] = Math.max(0, after);
      if (after <= 0) {
        broke = true;
        this.brokenOrder.push(index);
        this.breaksBy[who] = (this.breaksBy[who] ?? 0) + 1;
      }
    }
    const body = amount * (spec.bodyFactor ?? 1);
    this.hp = Math.max(0, this.hp - body);
    return { body, broke, killed: this.hp <= 0 };
  }

  /** 攻撃・行動が壊れた部位のために使えないか */
  disabled(action: string): boolean {
    for (let i = 0; i < this.specs.length; i++)
      if (this.isBroken(i) && this.specs[i]?.effects?.disable?.includes(action)) return true;
    return false;
  }

  /** 壊れた部位の倍率の積（無ければ 1） */
  mul(key: string): number {
    let m = 1;
    for (let i = 0; i < this.specs.length; i++) {
      if (!this.isBroken(i)) continue;
      const v = this.specs[i]?.effects?.mul?.[key];
      if (v !== undefined) m *= v;
    }
    return m;
  }

  /** 部位の HP の割合（0〜1。壊れない部位は 1） */
  partRatio(index: number): number {
    const max = this.partMaxHp[index] ?? 0;
    return max > 0 ? Math.max(0, this.partHp[index] ?? 0) / max : 1;
  }

  /** 成績の 1 人分（部位ごとの与ダメージは整数に丸める） */
  scoreOf(attacker: number): { partDamage: number[]; breaks: number } {
    const row = this.damageBy[attacker] ?? [];
    return { partDamage: row.map((v) => Math.round(v)), breaks: this.breaksBy[attacker] ?? 0 };
  }
}

const NO_HIT: PartHit = { body: 0, broke: false, killed: false };
