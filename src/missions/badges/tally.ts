// 勲章の拡充（9-10b）の 1 回の飛行のまとめ（Three.js・DOM 非依存）: 飛行を出たときに、観測役（SortieWatch）の数えと
// モードの結果から、通算の記録に足す分（キー → 数。src/progression/stats.ts の statKey）と、飛行の中で取る組み合わせの勲章を決める。
// 入力は初期状態（リプレイのヘッダと同じ ReplayStart）と GamePlay の状態だけなので、同じ記録の再生で同じ結果になる
import { BADGE_CONFIG } from '../../data/badges';
import { comboId, MISSION_S_ASSISTS } from '../../data/badges-catalog';
import { VORGAS_ID } from '../../data/raid-kaiju';
import { statKey } from '../../progression/stats';
import type { ReplayStart } from '../../replay/types';
import type { GamePlay } from '../game-play';
import { MANEUVERS } from './maneuvers';
import type { AssistLevel, SortieWatch } from './sortie';

/** 戦いの撃墜に数える種類（的・怪獣の部位・そのほかは除く） */
const COMBAT_KINDS = ['fighter', 'bomber', 'cruise', 'ground'] as const;
const WEAPONS = ['gun', 'missile', 'rocket', 'bomb'] as const;

/** 通算の記録のモード（日替わりは練習場・レースと分ける） */
export function sortieModeOf(start: Readonly<ReplayStart>): string {
  return start.daily ? 'daily' : start.mode;
}

/** 遊んだもの（ミッション id・raid-怪獣・course-コース・defense-マップ・practice-課題・daily-種類。フリーフライトは null） */
export function sortieTargetOf(start: Readonly<ReplayStart>): string | null {
  if (start.daily) return `daily-${start.daily.kind}`;
  switch (start.mode) {
    case 'mission':
      return start.missionId ?? null;
    case 'raid':
      return `raid-${start.raidKaiju ?? VORGAS_ID}`;
    case 'race':
      return start.courseId ? `course-${start.courseId}` : null;
    case 'defense':
      return `defense-${start.mapId}`;
    case 'practice':
      return start.practiceDrill ? `practice-${start.practiceDrill}` : null;
    default:
      return null;
  }
}

/** 難易度（フリーフライトは敵がいるときの敵の強さ、レイド・防衛戦は通常 / 高難度。ほかは null） */
export function sortieDifficultyOf(start: Readonly<ReplayStart>): string | null {
  if (start.mode === 'free') return start.enemies.enabled ? start.enemies.difficulty : null;
  if (start.mode === 'raid') return start.raidDifficulty ?? 'normal';
  if (start.mode === 'defense') return start.defenseDifficulty ?? 'normal';
  return null;
}

/** 成功（ミッション・レイドの成功・レースの完走・防衛戦の全波・練習場 / 日替わりを最後まで。フリーフライトは無い） */
export function sortieSucceeded(start: Readonly<ReplayStart>, play: GamePlay): boolean {
  switch (start.mode) {
    case 'mission':
    case 'raid':
      return play.runner?.result?.outcome === 'success';
    case 'race':
      return play.race?.result?.outcome === 'finished';
    case 'defense':
      return play.defense?.phase === 'cleared';
    case 'practice':
      return play.practice?.result != null;
    default:
      return false;
  }
}

export interface SortieTally {
  /** 通算の記録に足す分 */
  readonly stats: Record<string, number>;
  /** 飛行の中で取った組み合わせの勲章 */
  readonly badges: string[];
}

/**
 * 1 回の飛行のまとめ。assist はこの飛行の補助の段（始めと終わりの設定の低い方・自動射撃で撃ったら「かんたん」。設定の無い記録は null）
 */
export function tallySortie(
  start: Readonly<ReplayStart>,
  play: GamePlay,
  watch: SortieWatch,
  assist: AssistLevel | null,
): SortieTally {
  const stats: Record<string, number> = {};
  const add = (key: string, n = 1): void => {
    if (n > 0) stats[key] = (stats[key] ?? 0) + n;
  };
  const mode = sortieModeOf(start);
  const target = sortieTargetOf(start);
  const diff = sortieDifficultyOf(start);
  const success = sortieSucceeded(start, play);
  // 出撃・成功（モード・遊んだもの・難易度・補助の段・機体）
  const counted = (base: 'sortie' | 'win'): void => {
    const k = base === 'sortie' ? statKey.sortieMode : statKey.winMode;
    add(base === 'sortie' ? statKey.sorties : statKey.wins);
    add(k(mode));
    if (target) add(base === 'sortie' ? statKey.sortieOf(target) : statKey.winOf(target));
    if (diff) add(base === 'sortie' ? statKey.sortieDifficulty(diff) : statKey.winDifficulty(diff));
    if (assist) add(base === 'sortie' ? statKey.sortieAssist(assist) : statKey.winAssist(assist));
    add(
      base === 'sortie'
        ? statKey.sortieAircraft(start.aircraftId)
        : statKey.winAircraft(start.aircraftId),
    );
  };
  counted('sortie');
  if (success) counted('win');
  // 撃墜: モード別はすべて、戦い（キャンペーン・レイド・防衛戦）は武器・種類・難易度別も。的・怪獣の部位は種類だけ
  const kc = watch.killCounts;
  const combat = start.mode === 'mission' || start.mode === 'raid' || start.mode === 'defense';
  let all = 0;
  for (const [k, n] of Object.entries(kc)) if (k.startsWith('t.')) all += n;
  add(statKey.killMode(mode), all);
  // 敵（的・部位を除く）の数。難易度別はフリーフライトの敵の強さ・レイド / 防衛戦の難易度ごと
  let enemies = 0;
  for (const kind of COMBAT_KINDS) enemies += kc[`t.${kind}`] ?? 0;
  if (diff) add(statKey.killDifficulty(diff), enemies);
  if (combat) {
    for (const w of WEAPONS) {
      let n = 0;
      for (const kind of COMBAT_KINDS) n += kc[`wt.${w}.${kind}`] ?? 0;
      add(statKey.killWeapon(w), n);
    }
    for (const kind of COMBAT_KINDS) add(statKey.killType(kind), kc[`t.${kind}`] ?? 0);
    add(statKey.kills, enemies);
  }
  add(statKey.killType('part'), kc['t.part'] ?? 0);
  add(statKey.killType('target'), kc['t.target'] ?? 0);
  // 飛行・機動
  add(statKey.flightSeconds, watch.flightSeconds);
  add(statKey.flightMeters, watch.flightMeters);
  for (const m of MANEUVERS) add(statKey.maneuver(m), watch.maneuvers.counts[m]);
  // リング（レース・日替わりの周回）・防衛戦の波
  const race = play.race;
  if (start.mode === 'race' && race)
    add(statKey.rings, race.status.filter((x) => x === 'passed').length);
  if (start.mode === 'defense' && play.defense)
    add(statKey.defenseWaves, play.defense.wavesCleared);
  // 被弾なし・撃墜されずにクリア（キャンペーンの M1 を除く・レイド）
  const result = play.runner?.result;
  const easy =
    start.mode === 'mission' && BADGE_CONFIG.easyMissions.includes(start.missionId ?? '');
  const downs = play.session.player.downCount;
  if (success && result && !easy) {
    if (result.damageTaken <= 0) add(statKey.clearNoHit);
    if (downs === 0) add(statKey.clearNoDown);
  }
  return { stats, badges: judgeCombos(start, play, assist, success, downs) };
}

/** 飛行の中で取る組み合わせ（怪獣 × 難易度の無傷・撃墜されず・補助むずかしい、ミッションの S（機体・補助の段）、コースのゴールド（機体）） */
function judgeCombos(
  start: Readonly<ReplayStart>,
  play: GamePlay,
  assist: AssistLevel | null,
  success: boolean,
  downs: number,
): string[] {
  const out: string[] = [];
  const skill = assist !== null && assist !== 'easy';
  const result = play.runner?.result;
  if (start.mode === 'raid' && success && result) {
    const kaiju = start.raidKaiju ?? VORGAS_ID;
    const diff = start.raidDifficulty ?? 'normal';
    if (skill && result.damageTaken <= 0) out.push(comboId.raidNoHit(kaiju, diff));
    if (skill && downs === 0) out.push(comboId.raidNoDown(kaiju, diff));
    if (assist === 'hard') out.push(comboId.raidAssistHard(kaiju, diff));
  }
  if (start.mode === 'mission' && success && result?.rank === 'S' && start.missionId) {
    out.push(comboId.missionS(start.missionId, start.aircraftId));
    const order: readonly string[] = ['easy', ...MISSION_S_ASSISTS];
    const have = assist === null ? -1 : order.indexOf(assist);
    for (const a of MISSION_S_ASSISTS)
      if (have >= order.indexOf(a)) out.push(comboId.missionSAssist(start.missionId, a));
  }
  const race = play.race?.result;
  if (
    start.mode === 'race' &&
    !start.daily &&
    start.courseId &&
    race?.outcome === 'finished' &&
    race.rank === 'S'
  )
    out.push(comboId.courseGold(start.courseId, start.aircraftId));
  return out;
}
