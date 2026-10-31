// 防衛戦（7-2）の波: 定義（src/data/defense-waves.ts）に人数・難易度の倍率を掛けて、出す敵の列と予告の数にする。Three.js 非依存
import type { Difficulty } from '../../data/ai';
import { DEFENSE_CONFIG, type DefenseDifficulty } from '../../data/defense';
import { DEFENSE_WAVES, type DefenseEnemyKind, type DefenseWaveDef } from '../../data/defense-waves';

/** 出す敵 1 機分（爆撃機の護衛は kind 'fighter' で escortOf に爆撃機の組の番号） */
export interface WaveSpawn {
  readonly kind: DefenseEnemyKind;
  readonly difficulty: Difficulty;
  /** 波の始まりから出るまでの秒数 */
  readonly delay: number;
  /** 組の中の番号（横に並べる位置） */
  readonly slot: number;
  /** 組の番号（爆撃機と護衛を同じ組で並べる） */
  readonly group: number;
  /** 爆撃機の護衛（同じ組の爆撃機の横に出る） */
  readonly escort: boolean;
}

/** 予告の数（護衛は戦闘機に数える） */
export interface WaveCounts {
  fighter: number;
  bomber: number;
  cruise: number;
}

/** 人数と難易度の倍率: (0.6 + 0.4 × 人数) × 難易度（ソロ・通常で 1） */
export function enemyScale(players: number, difficulty: DefenseDifficulty): number {
  const c = DEFENSE_CONFIG.coopScale;
  const n = Math.max(1, Math.min(4, Math.round(players)));
  return (c.base + c.perPlayer * n) * DEFENSE_CONFIG.enemyScale[difficulty];
}

/** 定義の数 → 実際の数（四捨五入。定義が 1 以上なら最低 1） */
export function scaledCount(base: number, scale: number): number {
  if (base <= 0) return 0;
  return Math.max(1, Math.round(base * scale));
}

export function waveDef(wave: number): DefenseWaveDef | null {
  return DEFENSE_WAVES[wave - 1] ?? null;
}

/** wave 番目（1 から）の出す敵の列（delay の順） */
export function buildWave(wave: number, players: number, difficulty: DefenseDifficulty): WaveSpawn[] {
  const def = waveDef(wave);
  if (!def) return [];
  const scale = enemyScale(players, difficulty);
  const out: WaveSpawn[] = [];
  def.groups.forEach((g, group) => {
    const n = scaledCount(g.count, scale);
    const delay = g.delay ?? 0;
    for (let i = 0; i < n; i++)
      out.push({ kind: g.kind, difficulty: g.difficulty, delay, slot: i, group, escort: false });
    const e = scaledCount(g.escort ?? 0, scale);
    for (let i = 0; i < e; i++)
      out.push({
        kind: 'fighter',
        difficulty: g.difficulty,
        delay,
        slot: n + i,
        group,
        escort: true,
      });
  });
  return out.sort((a, b) => a.delay - b.delay);
}

/** 列の種類ごとの数（予告） */
export function countWave(spawns: readonly WaveSpawn[]): WaveCounts {
  const c: WaveCounts = { fighter: 0, bomber: 0, cruise: 0 };
  for (const s of spawns) c[s.kind]++;
  return c;
}

/** 予告の文（例「北東から 爆撃機 2・戦闘機 3」。0 の種類は書かない） */
export function forecastText(direction: string, c: Readonly<WaveCounts>): string {
  const parts: string[] = [];
  if (c.bomber > 0) parts.push(`爆撃機 ${c.bomber}`);
  if (c.fighter > 0) parts.push(`戦闘機 ${c.fighter}`);
  if (c.cruise > 0) parts.push(`巡航ミサイル ${c.cruise}`);
  return `${direction}から ${parts.join('・')}`;
}
