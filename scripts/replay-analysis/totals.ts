// 9-1 操作の診断: 集計の入れ物（ステップ数で数え、複数の記録は足し合わせる）と、表に出す値
type Axis = 'pitch' | 'roll' | 'yaw';

export interface FireCounts {
  /** 予測照準点が当たる範囲（的の半径 × 判定の拡大 / 距離）の中 */
  inHitCone: number;
  /** 当たる範囲の外だが 2° 以内 */
  within2: number;
  /** 2° を超え、エイムアシストの円錐（8°）以内 */
  withinAssist: number;
  /** 8° を超える */
  wide: number;
  /** 機銃の射程（1500m）の外 */
  outOfRange: number;
  /** 対象を選んでいない */
  noTarget: number;
}

export interface Bucket {
  engaged: number;
  angleSum: number;
  onScreen: number;
  firing: number;
}

export class Totals {
  files = 0;
  successes = 0;
  missionStatus = '';
  steps = 0;
  aliveSteps = 0;
  analogSteps = 0;
  assistSteps = 0;
  readonly stick = { zero: 0, low: 0, mid: 0, edge: 0 };
  pitchEdge = 0;
  rollEdge = 0;
  /** 端に 1 秒以上倒し続けた回数と、最長の秒数 */
  edgeHolds = 0;
  edgeLongest = 0;
  readonly reversals: Record<Axis, number> = { pitch: 0, roll: 0, yaw: 0 };
  readonly quickReversals: Record<Axis, number> = { pitch: 0, roll: 0, yaw: 0 };
  engagedSteps = 0;
  offScreenSteps = 0;
  nearSteps = 0;
  crossings = 0;
  /** 角度の分布（度の区切りごとのステップ数） */
  readonly angleBins = [0, 0, 0, 0, 0, 0];
  readonly reacquire: number[] = [];
  readonly fire: FireCounts = {
    inHitCone: 0,
    within2: 0,
    withinAssist: 0,
    wide: 0,
    outOfRange: 0,
    noTarget: 0,
  };
  bursts = 0;
  /** 選択中の対象が変わった回数（タップ・切り替え・撃墜の後の自動の選び直し） */
  targetSwitches = 0;
  /** 戦域の外（警告が出ている）にいたステップ数 */
  outsideSteps = 0;
  shots = 0;
  hits = 0;
  kills = 0;
  downs = 0;
  missiles = 0;
  missilesLocked = 0;
  missileDetonations = 0;
  readonly missileAngles: number[] = [];
  readonly buckets: Bucket[] = [];

  static readonly ANGLE_EDGES = [2, 5, 10, 30, 90] as const;

  addAngle(bucket: number, angle: number): void {
    let i = 0;
    while (i < Totals.ANGLE_EDGES.length && angle > (Totals.ANGLE_EDGES[i] ?? 0)) i++;
    this.angleBins[i] = (this.angleBins[i] ?? 0) + 1;
    this.bucketAt(bucket).angleSum += angle;
  }

  addBucket(bucket: number, onScreen: boolean, firing: boolean): void {
    const b = this.bucketAt(bucket);
    b.engaged++;
    if (onScreen) b.onScreen++;
    if (firing) b.firing++;
  }

  private bucketAt(i: number): Bucket {
    while (this.buckets.length <= i)
      this.buckets.push({ engaged: 0, angleSum: 0, onScreen: 0, firing: 0 });
    const b = this.buckets[i];
    if (!b) throw new Error('bucket');
    return b;
  }

  /** 別の記録の集計を足す（推移は足さない） */
  merge(o: Totals): void {
    const nums = [
      'files',
      'successes',
      'steps',
      'aliveSteps',
      'analogSteps',
      'assistSteps',
      'pitchEdge',
      'rollEdge',
      'edgeHolds',
      'engagedSteps',
      'offScreenSteps',
      'nearSteps',
      'crossings',
      'bursts',
      'targetSwitches',
      'outsideSteps',
      'shots',
      'hits',
      'kills',
      'downs',
      'missiles',
      'missilesLocked',
      'missileDetonations',
    ] as const;
    const first = this.files === 0;
    for (const k of nums) this[k] += o[k];
    this.edgeLongest = Math.max(this.edgeLongest, o.edgeLongest);
    for (const k of Object.keys(this.stick) as (keyof Totals['stick'])[])
      this.stick[k] += o.stick[k];
    for (const k of ['pitch', 'roll', 'yaw'] as const) {
      this.reversals[k] += o.reversals[k];
      this.quickReversals[k] += o.quickReversals[k];
    }
    o.angleBins.forEach((v, i) => {
      this.angleBins[i] = (this.angleBins[i] ?? 0) + v;
    });
    for (const k of Object.keys(this.fire) as (keyof FireCounts)[]) this.fire[k] += o.fire[k];
    this.reacquire.push(...o.reacquire);
    this.missileAngles.push(...o.missileAngles);
    this.missionStatus = first ? o.missionStatus : '';
  }

  get aliveMinutes(): number {
    return this.aliveSteps / 3600;
  }

  get fireSteps(): number {
    const f = this.fire;
    return f.inHitCone + f.within2 + f.withinAssist + f.wide + f.outOfRange + f.noTarget;
  }
}

/** 中央値（空なら NaN） */
export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? NaN) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}
