// 勲章（9-10）の 1 回の飛行の判定（Three.js・DOM 非依存）: 固定ステップごとに決まった計算の値（自機・武装の残り・撃墜の数え）を
// 読んで数え（SortieWatch）、飛行の終わりにモードの結果と合わせて取った勲章を決める（judgeSortie）。
// 入力は初期状態（リプレイのヘッダと同じ ReplayStart）と GamePlay の状態だけなので、本番の飛行と同じ記録の再生で同じ結果になる。
// 記録しない飛行（チュートリアル・PvP・協力）は見ない（協力・PvP は対戦の終わりの集計: judgeMatch）
import { BADGE_CONFIG } from '../../data/badges';
import { KAIJU2_PARTS } from '../../data/kaiju2';
import { NEPHIRGA_ID } from '../../data/raid-kaiju';
import type { ReplayControls, ReplayStart } from '../../replay/types';
import { freeExtraOf } from '../free-extra';
import type { GamePlay } from '../game-play';
import type { CombatTarget } from '../../combat/target';
import type { PlayerWeapon } from '../../combat/kill-feed';
import { killKindOf } from './kill-kind';
import { ManeuverWatch } from './maneuvers';

/** 補助の段（9-10b）: 組の かんたん / ふつう / むずかしい に合わせた 3 段。キーボード・パッドは「むずかしい」 */
export type AssistLevel = 'easy' | 'normal' | 'hard';

/**
 * 記録の操作の設定（始めた時点）の補助の段: タッチは自動射撃・速度合わせ・狙いの補助「強」のどれかで「かんたん」、
 * 狙いの補助「標準」で「ふつう」、「弱」で「むずかしい」（組と同じ値ならその組。カスタムも同じ規則）。
 * キーボード（補助なし）・パッド（狙いの補助「弱」だけ）は「むずかしい」。設定の無い記録（9-2 より前）は null
 */
export function assistLevelOf(c: Readonly<ReplayControls> | null | undefined): AssistLevel | null {
  if (!c) return null;
  if (c.device !== 'touch') return 'hard';
  const aim = c.aimAssist ?? 'normal';
  if (c.autoFire === true || c.speedMatch === true || aim === 'strong') return 'easy';
  return aim === 'normal' ? 'normal' : 'hard';
}

/** 補助の段の低い方（始めと終わりの設定・飛行中の自動射撃） */
export function lowerAssist(a: AssistLevel | null, b: AssistLevel | null): AssistLevel | null {
  if (a === null || b === null) return null;
  const order: readonly AssistLevel[] = ['easy', 'normal', 'hard'];
  return order[Math.min(order.indexOf(a), order.indexOf(b))] ?? null;
}

/**
 * 補助の組「ふつう」以上か（記録の操作の設定 = 始めた時点）: キーボード（補助なし）・パッド（狙いの補助「弱」だけ）はそのまま、
 * タッチは自動射撃・速度合わせが OFF で狙いの補助が「弱」か「標準」（= 組の「ふつう」「むずかしい」と、それより補助の少ないカスタム）。
 * 設定の無い記録（9-2 より前）は数えない
 */
export function assistQualifies(c: Readonly<ReplayControls> | null | undefined): boolean {
  const level = assistLevelOf(c);
  return level !== null && level !== 'easy';
}

/** 1 回の飛行の数え（固定ステップの後に step） */
export class SortieWatch {
  readonly maneuvers = new ManeuverWatch();
  /** 自分が落とした敵機（撃墜の数え（敵側を落とした数）と敵機の破壊の数えが両方増えた分） */
  fighterKills = 0;
  missileUsed = false;
  ordnanceUsed = false;
  /** 自動射撃で撃った（記録の印 8。補助の判定に使う） */
  autoFired = false;
  /** 9-10b: 落とした対象の数（「w.武器」「t.種類」「wt.武器.種類」→ 数）・飛行時間（秒）・距離（m） */
  killCounts: Record<string, number> = {};
  flightSeconds = 0;
  flightMeters = 0;
  /** 数えている飛行の間だけ撃墜を受ける（リプレイの再生・記録しない飛行では数えない） */
  private live = false;
  private kills = 0;
  private fighters = 0;
  private missiles = 0;
  private rockets = 0;
  private bombs = 0;

  /** 飛行の始め（初期状態から世界を作った直後） */
  begin(play: GamePlay): void {
    this.maneuvers.reset();
    this.fighterKills = 0;
    this.missileUsed = false;
    this.ordnanceUsed = false;
    this.autoFired = false;
    this.killCounts = {};
    this.flightSeconds = 0;
    this.flightMeters = 0;
    this.live = true;
    this.keep(play);
  }

  /** 飛行の終わり（ここから後の撃墜は数えない） */
  end(): void {
    this.live = false;
  }

  /** プレイヤーが落とした（CombatSystem.onPlayerKill から。固定ステップの中） */
  kill(target: CombatTarget, weapon: PlayerWeapon): void {
    if (!this.live) return;
    const kind = killKindOf(target);
    for (const k of [`w.${weapon}`, `t.${kind}`, `wt.${weapon}.${kind}`])
      this.killCounts[k] = (this.killCounts[k] ?? 0) + 1;
  }

  /** 固定ステップの後。autoFire はこのステップの引き金が自動射撃からか（記録の flags の 8） */
  step(play: GamePlay, dt: number, autoFire: boolean): void {
    const s = play.session;
    const c = s.combat;
    const st = s.aircraft.state;
    const p = st.position;
    this.maneuvers.step(
      {
        position: p,
        orientation: st.orientation,
        speed: st.speed,
        agl: p.y - s.groundAt(p.x, p.z),
        active: s.player.active,
        downs: s.player.downCount,
      },
      dt,
    );
    if (s.player.active) {
      this.flightSeconds += dt;
      this.flightMeters += Math.max(0, st.speed) * dt;
    }
    const kills = c.kills - this.kills;
    const fighters = s.destroyedCount('enemyFighter') - this.fighters;
    if (kills > 0 && fighters > 0) this.fighterKills += Math.min(kills, fighters);
    // 残りが減ったら撃った（補充・復帰では増えるだけ）
    if (c.missileAmmo.count < this.missiles) this.missileUsed = true;
    if (c.rockets.count < this.rockets || c.bombs.count < this.bombs) this.ordnanceUsed = true;
    if (autoFire) this.autoFired = true;
    this.keep(play);
  }

  private keep(play: GamePlay): void {
    const s = play.session;
    const c = s.combat;
    this.kills = c.kills;
    this.fighters = s.destroyedCount('enemyFighter');
    this.missiles = c.missileAmmo.count;
    this.rockets = c.rockets.count;
    this.bombs = c.bombs.count;
  }
}

/** ネフィルガの壊した部位の数（遅延チャンクの差し込み口の状態。付いていなければ 0） */
function nephirgaBroken(play: GamePlay): number {
  const extra = freeExtraOf(play);
  if (!extra?.active) return 0;
  const root = extra.stateRoot;
  return 'brokenCount' in root && typeof root.brokenCount === 'number' ? root.brokenCount : 0;
}

/**
 * 飛行の終わりに取った勲章（段階なし）を決める。start は初期状態、assist は補助の組「ふつう」以上だったか
 * （始めた時点の設定・自動射撃を使っていない・本番は終わりの設定も）。記録から取れるもの（クリア・ランク）は progression/badges.ts
 */
export function judgeSortie(
  start: Readonly<ReplayStart>,
  play: GamePlay,
  watch: SortieWatch,
  assist: boolean,
): string[] {
  const c = BADGE_CONFIG;
  const out: string[] = [...watch.maneuvers.done];
  const skill = assist && !watch.autoFired;
  if (watch.fighterKills > 0) out.push('firstKill');
  const combat = start.mode === 'mission' || start.mode === 'raid' || start.mode === 'defense';
  if (combat && watch.fighterKills >= c.aceKills) out.push('ace');
  const result = play.runner?.result;
  const success =
    (start.mode === 'mission' || start.mode === 'raid') && result?.outcome === 'success';
  if (success && start.mode === 'mission' && !c.easyMissions.includes(start.missionId ?? '')) {
    if (skill && !watch.missileUsed && !watch.ordnanceUsed) out.push('gunsOnly');
    if (skill && result.damageTaken <= 0) out.push('flawless');
  }
  if (success && start.mode === 'raid' && skill && play.session.player.downCount === 0)
    out.push('raidNoLoss');
  // ネフィルガ（ソロのレイド・キャンペーンの決戦）の部位をすべて壊して倒した
  const nephirga = start.raidKaiju === NEPHIRGA_ID || start.missionId === 'finale';
  if (success && nephirga && nephirgaBroken(play) >= KAIJU2_PARTS.length) out.push('nephirgaParts');
  const race = play.race?.result;
  if (start.mode === 'race' && race?.outcome === 'finished' && race.missed === 0)
    out.push('cleanRun');
  const practice = play.practice?.result;
  if (start.mode === 'practice' && !start.daily && practice && skill) {
    const s = c.sharpshooter;
    if (practice.kills >= s.kills && (practice.accuracy ?? 0) >= s.accuracy)
      out.push('sharpshooter');
  }
  return out;
}

/** 協力・PvP の対戦の終わり（ロビーのリザルトと同じ集計） */
export interface MatchSummary {
  /** 協力のレイド・防衛戦を守り切った / 倒した */
  readonly coopClear: boolean;
  /** 協力か（レイド・防衛戦） */
  readonly coop: boolean;
  readonly players: number;
  /** PvP で勝った（個人戦の 1 位・チーム戦の勝ったチーム） */
  readonly pvpWin: boolean;
  /** 9-10b: 自分の撃墜数（PvP の通算の記録） */
  readonly kills: number;
}

export function judgeMatch(m: Readonly<MatchSummary>): string[] {
  const out: string[] = [];
  if (m.coop && m.coopClear) {
    out.push('coopClear');
    if (m.players >= BADGE_CONFIG.coopPlayers) out.push('coopFour');
  }
  if (!m.coop && m.pvpWin && m.players >= 2) out.push('pvpWin');
  return out;
}
