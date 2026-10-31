// PvP のルール（5-3）: 撃墜数と制限時間（ロビーでホストが選ぶ）。どちらかに達したら終わり、順位・撃墜・被撃墜・命中率を出す。
// 5-4: チーム戦（チームの合計で撃墜数に達したら終わり）、初心者保護の条件、開始前のカウントダウン、ベストプレイヤー。
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

  constructor(
    readonly settings: MatchSettings,
    /** チーム戦ならプレイヤー ID → チーム（撃墜数はチームの合計で比べる）。個人戦は null */
    private readonly teamOf: ((id: number) => number | undefined) | null = null,
  ) {}

  get remainingSeconds(): number {
    return Math.max(0, this.settings.timeLimitSeconds - this.elapsed);
  }

  /** 固定ステップ 1 回分。このステップで終わったら終わり方を返す（終わった後は何もしない） */
  step(dt: number, scores: Iterable<PlayerScore>): MatchEnd | null {
    if (this.ended) return null;
    this.elapsed += dt;
    const teamOf = this.teamOf;
    if (teamOf) {
      for (const total of teamTotals(scores, teamOf).values()) {
        if (total >= this.settings.scoreLimit) {
          this.ended = 'score';
          return this.ended;
        }
      }
    } else {
      for (const s of scores) {
        if (s.kills >= this.settings.scoreLimit) {
          this.ended = 'score';
          return this.ended;
        }
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

/** チームごとの撃墜数の合計（チームの番号 → 合計。チームのない人は数えない） */
export function teamTotals(
  scores: Iterable<Readonly<PlayerScore>>,
  teamOf: (id: number) => number | undefined,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const s of scores) {
    const t = teamOf(s.id);
    if (t === undefined) continue;
    out.set(t, (out.get(t) ?? 0) + s.kills);
  }
  return out;
}

/**
 * 初心者保護の対象か: 撃墜数が最下位（同じ最下位が複数なら全員）。全員が同じ撃墜数のとき（開始直後など）は誰も対象にしない
 */
export function isRookie(id: number, scores: readonly Readonly<PlayerScore>[]): boolean {
  const me = scores.find((s) => s.id === id);
  if (!me || scores.length < 2) return false;
  let min = Infinity;
  let max = -Infinity;
  for (const s of scores) {
    min = Math.min(min, s.kills);
    max = Math.max(max, s.kills);
  }
  return max > min && me.kills === min;
}

/** ベストプレイヤー（最多撃墜。同じなら被撃墜の少ない方 → 命中率の高い方 → ID の小さい方）。誰も撃墜していなければ null */
export function bestPlayer<T extends PlayerScore>(scores: readonly T[]): T | null {
  let best: T | null = null;
  for (const s of scores) {
    if (s.kills <= 0) continue;
    if (
      !best ||
      s.kills > best.kills ||
      (s.kills === best.kills &&
        (s.deaths < best.deaths || (s.deaths === best.deaths && accuracy(s) > accuracy(best))))
    )
      best = s;
  }
  return best;
}

/**
 * 開始前のカウントダウン（5-4）。固定ステップで数え、終わるまで active。ホストもクライアントも飛行の始めから数える
 * （クライアントは開始の知らせが届いた分だけ遅れて始まる）
 */
export class Countdown {
  private remainingTicks: number;

  constructor(
    seconds: number,
    private readonly tickHz = 60,
  ) {
    this.remainingTicks = Math.round(seconds * tickHz);
  }

  get active(): boolean {
    return this.remainingTicks > 0;
  }

  /** 残り秒数（0 は終わり） */
  get remainingSeconds(): number {
    return this.remainingTicks / this.tickHz;
  }

  /** 1 ステップ進める。このステップの間カウント中だったら true（そのステップは操作を無視する） */
  step(): boolean {
    if (this.remainingTicks <= 0) return false;
    this.remainingTicks--;
    return true;
  }
}
