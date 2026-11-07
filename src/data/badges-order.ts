// 勲章の並び（9-10c）: この並びの順に番号（No.001〜）を振る。カテゴリの順は BADGE_GROUPS、同じ種類の段は続けて（10 → 50 → 100…）、
// レイドの中は怪獣ごと（RAID_KAIJU_IDS の順。新しい怪獣は最後に足される）。報酬・判定は 9-10 / 9-10b のまま。
// id はセーブのキーなので変えない（並びを変えても記録は残る）。決定は docs/decisions.md の 9-10c
import { AIRCRAFT_MODELS } from './aircraft';
import {
  BADGE_GROUPS,
  BADGE_REWARDS,
  comboId,
  MISSION_S_ASSISTS,
  type BadgeDef,
  type BadgeGroup,
  type BadgeStep,
  type StatUnit,
} from './badges-catalog';
import { COURSES } from './courses';
import { DEFENSE_DIFFICULTIES, DEFENSE_MAPS } from './defense';
import { MISSIONS } from './missions';
import { RAID_DIFFICULTIES } from './raid';
import { shownRaidKaiju } from './raid-kaiju';

type Draft = Omit<BadgeDef, 'no'>;

interface LadderSpec {
  readonly id: string;
  readonly keys: readonly string[];
  readonly steps: readonly number[];
  readonly unit?: StatUnit;
  /** 隠す段（しきい値。表示の単位） */
  readonly hidden?: readonly number[];
}

const UNIT_SCALE: Readonly<Record<StatUnit, number>> = { count: 1, hours: 3600, km: 1000 };
const AIRCRAFT_IDS = AIRCRAFT_MODELS.map((m) => m.id);

/** カテゴリごとの並び（BADGE_GROUPS の順につなぐ） */
function build(): Record<BadgeGroup, Draft[]> {
  const out = Object.fromEntries(BADGE_GROUPS.map((g) => [g, [] as Draft[]])) as Record<
    BadgeGroup,
    Draft[]
  >;
  let group: BadgeGroup = 'career';
  const push = (d: Omit<Draft, 'group'>): void => {
    out[group].push({ ...d, group });
  };
  /** 9-10 からの 1 つの勲章（報酬は 9-10 のまま） */
  const item = (
    id: string,
    reward: number,
    extra: Partial<Pick<Draft, 'chain' | 'step' | 'skill' | 'hidden'>> = {},
  ): void => {
    push({ id, reward, chain: extra.chain ?? id, ...extra });
  };
  /** 段階の数え（通算の記録の合計がしきい値以上。1 段ずつ別の勲章） */
  const ladder = (l: LadderSpec): void => {
    const unit = l.unit ?? 'count';
    for (const n of l.steps)
      push({
        id: `l.${l.id}.${String(n)}`,
        reward: BADGE_REWARDS.each,
        chain: l.id,
        step: { n, unit },
        ...(l.hidden?.includes(n) ? { hidden: true } : {}),
        stat: { ladder: l.id, keys: l.keys, goal: n * UNIT_SCALE[unit], shown: n, unit },
      });
  };
  const combo = (
    id: string,
    family: string,
    params: Record<string, string>,
    chain: string,
    step: BadgeStep,
    extra: Partial<Pick<Draft, 'skill' | 'hidden'>> = {},
  ): void => {
    push({ id, reward: BADGE_REWARDS.each, chain, step, combo: { family, params }, ...extra });
  };
  const n1: BadgeStep = { n: 1, unit: 'count' };

  group = 'career';
  ladder({ id: 'sortie', keys: ['sortie'], steps: [10, 50, 100, 250, 500, 1000], hidden: [1000] });
  ladder({ id: 'win', keys: ['win'], steps: [10, 50, 100, 250, 500] });
  ladder({ id: 'winNormal', keys: ['win.a.normal', 'win.a.hard'], steps: [10, 50, 200] });
  ladder({ id: 'winHard', keys: ['win.a.hard'], steps: [10, 50, 200] });
  ladder({
    id: 'time',
    keys: ['time'],
    steps: [1, 5, 10, 25, 50, 100],
    unit: 'hours',
    hidden: [100],
  });
  ladder({
    id: 'dist',
    keys: ['dist'],
    steps: [100, 500, 1000, 5000, 10000, 50000],
    unit: 'km',
    hidden: [50000],
  });
  for (const ac of AIRCRAFT_IDS)
    ladder({ id: `ac.${ac}`, keys: [`sortie.ac.${ac}`], steps: [10, 50, 200] });

  group = 'flight';
  // 9-10 の「1 回」の勲章を、同じ機動の回数の段の頭に
  item('loop', 300, { chain: 'mvLoop', step: n1 });
  ladder({ id: 'mvLoop', keys: ['mv.loop'], steps: [10, 50, 200, 1000], hidden: [1000] });
  item('immelmann', 500, { chain: 'mvImmelmann', step: n1 });
  ladder({ id: 'mvImmelmann', keys: ['mv.immelmann'], steps: [10, 50, 200] });
  item('lowPass', 500, { chain: 'mvLowPass', step: n1 });
  ladder({ id: 'mvLowPass', keys: ['mv.lowPass'], steps: [10, 50, 200] });
  item('inverted', 300, { chain: 'mvInverted', step: n1 });
  ladder({ id: 'mvInverted', keys: ['mv.inverted'], steps: [10, 50, 200] });
  item('topSpeed', 300, { chain: 'mvTopSpeed', step: n1 });
  ladder({ id: 'mvTopSpeed', keys: ['mv.topSpeed'], steps: [10, 50, 200] });

  group = 'combat';
  item('firstKill', 300, { chain: 'killFighter', step: n1 });
  ladder({ id: 'killFighter', keys: ['kill.t.fighter'], steps: [25, 100, 500] });
  ladder({
    id: 'kill',
    keys: ['kill'],
    steps: [10, 50, 100, 250, 500, 1000, 2500],
    hidden: [2500],
  });
  ladder({ id: 'killGun', keys: ['kill.w.gun'], steps: [50, 200, 1000] });
  ladder({ id: 'killMissile', keys: ['kill.w.missile'], steps: [50, 200, 1000] });
  ladder({ id: 'killRocket', keys: ['kill.w.rocket'], steps: [25, 100, 500] });
  ladder({ id: 'killBomb', keys: ['kill.w.bomb'], steps: [25, 100, 500] });
  ladder({ id: 'killBomber', keys: ['kill.t.bomber'], steps: [10, 50, 200] });
  ladder({ id: 'killCruise', keys: ['kill.t.cruise'], steps: [10, 50, 200] });
  ladder({ id: 'killGround', keys: ['kill.t.ground'], steps: [25, 100, 500] });
  ladder({ id: 'killHard', keys: ['kill.d.hard'], steps: [25, 100, 500] });
  ladder({ id: 'killFree', keys: ['kill.m.free'], steps: [50, 250, 1000] });
  item('ace', 1000);
  item('gunsOnly', 1500, { skill: true });
  item('flawless', 1500, { skill: true });
  ladder({ id: 'noHit', keys: ['clear.noHit'], steps: [5, 25, 100] });
  ladder({ id: 'noDown', keys: ['clear.noDown'], steps: [10, 50, 200] });

  group = 'campaign';
  item('campaign', 1000, { step: { key: 'badges.step.clearAll' } });
  item('campaignA', 2000, { chain: 'campaign', step: { key: 'badges.step.rankA' } });
  item('campaignS', 4000, { chain: 'campaign', step: { key: 'badges.step.rankS' } });
  ladder({ id: 'sortieMission', keys: ['sortie.m.mission'], steps: [10, 50, 100] });
  for (const m of MISSIONS) {
    for (const ac of AIRCRAFT_IDS)
      combo(
        comboId.missionS(m.id, ac),
        'missionS',
        { mission: m.id, aircraft: ac },
        `missionS.${m.id}`,
        { word: 'aircraft', id: ac },
      );
    for (const a of MISSION_S_ASSISTS)
      combo(
        comboId.missionSAssist(m.id, a),
        'missionSAssist',
        { mission: m.id, assist: a },
        `missionSAssist.${m.id}`,
        { word: 'assistShort', id: a },
      );
  }

  group = 'race';
  item('raceMedals', 1000, { step: { key: 'badges.step.finishAll' } });
  item('raceMedalsA', 2000, { chain: 'raceMedals', step: { key: 'badges.step.rankA' } });
  item('raceMedalsS', 4000, { chain: 'raceMedals', step: { key: 'badges.step.gold' } });
  item('cleanRun', 500);
  ladder({ id: 'sortieRace', keys: ['sortie.m.race'], steps: [10, 50, 200] });
  ladder({ id: 'ring', keys: ['ring'], steps: [100, 500, 1000, 5000], hidden: [5000] });
  for (const c of COURSES)
    for (const ac of AIRCRAFT_IDS)
      combo(
        comboId.courseGold(c.id, ac),
        'courseGold',
        { course: c.id, aircraft: ac },
        `courseGold.${c.id}`,
        { word: 'aircraft', id: ac },
      );

  group = 'defense';
  for (const m of DEFENSE_MAPS)
    for (const diff of DEFENSE_DIFFICULTIES)
      combo(
        comboId.defenseClear(m.mapId, diff),
        'defenseClear',
        { map: m.mapId, diff },
        `defenseClear.${m.mapId}`,
        { word: 'diff', id: diff },
      );
  ladder({ id: 'sortieDefense', keys: ['sortie.m.defense'], steps: [5, 25, 100] });
  ladder({ id: 'waves', keys: ['waves'], steps: [50, 200, 1000] });

  group = 'practice';
  item('tutorial', 500);
  item('practiceAll', 300);
  item('sharpshooter', 1000, { skill: true });
  ladder({ id: 'sortiePractice', keys: ['sortie.m.practice'], steps: [10, 50, 200] });
  ladder({ id: 'killTarget', keys: ['kill.t.target'], steps: [100, 500, 2000], hidden: [2000] });

  group = 'daily';
  item('dailyStreak', 500, { step: { n: 3, unit: 'days' } });
  item('dailyStreak7', 1500, { chain: 'dailyStreak', step: { n: 7, unit: 'days' } });
  item('dailyStreak30', 4000, { chain: 'dailyStreak', step: { n: 30, unit: 'days' } });
  ladder({ id: 'dailyDays', keys: ['daily.days'], steps: [7, 30, 100, 365], hidden: [365] });
  item('dailyAll', 500);

  group = 'coop';
  item('coopClear', 1000, { chain: 'coopClear', step: n1 });
  ladder({
    id: 'coopClear',
    keys: ['coop.clear.2', 'coop.clear.3', 'coop.clear.4'],
    steps: [5, 25, 100],
  });
  ladder({ id: 'coop2', keys: ['coop.clear.2'], steps: [3, 10] });
  ladder({ id: 'coop3', keys: ['coop.clear.3'], steps: [3, 10] });
  item('coopFour', 1500, { chain: 'coop4', step: n1 });
  ladder({ id: 'coop4', keys: ['coop.clear.4'], steps: [3, 10] });

  group = 'pvp';
  ladder({ id: 'pvpPlay', keys: ['pvp.play'], steps: [10, 50, 200] });
  item('pvpWin', 1000, { chain: 'pvpWin', step: n1 });
  ladder({ id: 'pvpWin', keys: ['pvp.win'], steps: [5, 25, 100] });
  item('pvpKills', 1500, { chain: 'pvpKill', step: { n: 25, unit: 'count' } });
  ladder({ id: 'pvpKill', keys: ['pvp.kill'], steps: [50, 100, 250, 1000], hidden: [1000] });

  group = 'raid';
  // 怪獣を問わないもの → 怪獣ごと（クリア・7 分未満・撃墜されず・被弾なし・補助むずかしい。それぞれ通常 → 高難度）
  ladder({ id: 'sortieRaid', keys: ['sortie.m.raid'], steps: [5, 25, 100] });
  ladder({ id: 'parts', keys: ['kill.t.part'], steps: [10, 50, 200] });
  item('raidNoLoss', 2000, { skill: true });
  // 10-2: 怪獣のまとまりは登録簿の順（新しい怪獣はレイドのカテゴリの最後に足される。番号がずれるのは収集だけ）。
  // 未公開の怪獣は ?dev=<名前> のときだけ
  for (const def of shownRaidKaiju()) {
    const kaiju = def.id;
    const each = (
      family: string,
      id: (k: string, d: string) => string,
      extra: (hard: boolean) => Partial<Pick<Draft, 'skill' | 'hidden'>> = () => ({}),
    ): void => {
      for (const diff of RAID_DIFFICULTIES)
        combo(
          id(kaiju, diff),
          family,
          { kaiju, diff },
          `${family}.${kaiju}`,
          { word: 'diff', id: diff },
          extra(diff === 'hard'),
        );
    };
    each('raidClear', comboId.raidClear);
    each('raidTimed', comboId.raidTimed);
    each('raidNoDown', comboId.raidNoDown, () => ({ skill: true }));
    each('raidNoHit', comboId.raidNoHit, (hard) => ({
      skill: true,
      ...(hard ? { hidden: true } : {}),
    }));
    each('raidAssistHard', comboId.raidAssistHard, (hard) => (hard ? { hidden: true } : {}));
    // 怪獣ごとの勲章（登録簿の badges。ネフィルガは部位をすべて壊した）
    // 10-3b: 通算の記録で取るもの（アルビオンの子分の撃墜）は記録の合計から
    for (const b of def.badges) {
      if (!b.stat) {
        item(b.id, b.reward);
        continue;
      }
      const n = b.stat.goal;
      const chain = b.id.replace(/\d+$/, '');
      push({
        id: b.id,
        reward: b.reward,
        chain,
        step: { n, unit: 'count' },
        stat: { ladder: chain, keys: b.stat.keys, goal: n, shown: n, unit: 'count' },
      });
    }
  }

  group = 'collect';
  for (const c of BADGE_REWARDS.collect) {
    const pct = Math.round(c.fraction * 100);
    push({
      id: `collect.${String(pct)}`,
      reward: c.credits,
      chain: 'collect',
      step: { n: pct, unit: 'pct' },
      collect: c.fraction,
      ...(c.fraction >= 1 ? { hidden: true } : {}),
    });
  }
  return out;
}

/** 全部の勲章（番号の順） */
export const BADGE_LIST: readonly BadgeDef[] = (() => {
  const groups = build();
  return BADGE_GROUPS.flatMap((g) => groups[g]).map((d, i) => ({ ...d, no: i + 1 }));
})();
