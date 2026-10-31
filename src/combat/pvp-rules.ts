// PvP のルール（5-3）: 撃墜数と制限時間（ロビーでホストが選ぶ）。どちらかに達したら終わり、順位・撃墜・被撃墜・命中率を出す。
// ホストが判定する。Three.js 非依存

export interface MatchSettings {
  readonly timeLimitSeconds: number;
  readonly scoreLimit: number;
}

/** 1 人分の成績 */
export interface PlayerScore {
  readonly id: number;
  readonly kills: number;
  readonly deaths: number;
  /** 機銃の発射数と命中数 */
  readonly shots: number;
  readonly hits: number;
}

export type MatchEnd = 'score' | 'time';

export class PvpMatch {
  elapsed = 0;
  ended: MatchEnd | null = null;

  constructor(readonly settings: MatchSettings) {}

  get remainingSeconds(): number {
    return Math.max(0, this.settings.timeLimitSeconds - this.elapsed);
  }

  /** 固定ステップ 1 回分。このステップで終わったら終わり方を返す（終わった後は何もしない） */
  step(dt: number, scores: Iterable<PlayerScore>): MatchEnd | null {
    if (this.ended) return null;
    this.elapsed += dt;
    for (const s of scores) {
      if (s.kills >= this.settings.scoreLimit) {
        this.ended = 'score';
        return this.ended;
      }
    }
    if (this.elapsed >= this.settings.timeLimitSeconds - 1e-9) {
      this.elapsed = this.settings.timeLimitSeconds;
      this.ended = 'time';
      return this.ended;
    }
    return null;
  }
}

/** 機銃の命中率（0〜1。撃っていなければ 0） */
export function accuracy(s: Readonly<PlayerScore>): number {
  return s.shots > 0 ? s.hits / s.shots : 0;
}

export interface Standing<T extends PlayerScore> {
  /** 1 から。撃墜数と被撃墜数が同じなら同じ順位 */
  readonly rank: number;
  readonly score: T;
}

/** 順位: 撃墜数の多い順 → 被撃墜数の少ない順（同じなら同順位。並びは ID 順） */
export function standings<T extends PlayerScore>(scores: readonly T[]): Standing<T>[] {
  const sorted = [...scores].sort(
    (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id,
  );
  const out: Standing<T>[] = [];
  sorted.forEach((score, i) => {
    const prev = out[i - 1];
    const same = prev && prev.score.kills === score.kills && prev.score.deaths === score.deaths;
    out.push({ rank: same ? prev.rank : i + 1, score });
  });
  return out;
}
