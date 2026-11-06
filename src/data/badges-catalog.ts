// 勲章の拡充（9-10b）の定義を表から作る: 段階の数え（通算の記録 stats のキーの合計がしきい値以上。1 段ずつ別の勲章）・
// 組み合わせ（怪獣 × 難易度 × 条件、ミッション × 機体 / 補助の組の S、コース × 機体のゴールド、防衛戦のマップ × 難易度）・集め（全体の割合）。
// 9-10 の 28 個は src/data/badges.ts のまま（id・報酬を変えない）。名前と条件の文は src/data/badges-text.ts が表の
// badges.ladder.<id> / badges.combo.<family> から組み立てる。決定は docs/decisions.md の 9-10b
import { AIRCRAFT_MODELS } from './aircraft';
import { COURSES } from './courses';
import { DEFENSE_DIFFICULTIES, DEFENSE_MAPS } from './defense';
import { MISSIONS } from './missions';
import { RAID_DIFFICULTIES } from './raid';
import { RAID_KAIJU_IDS } from './raid-kaiju';

/** まとまり（一覧のカテゴリ。9-10 の 10 個 + 通算 career・集め collect） */
export const BADGE_GROUPS = [
  'flight',
  'combat',
  'campaign',
  'raid',
  'race',
  'defense',
  'practice',
  'daily',
  'coop',
  'pvp',
  'career',
  'collect',
] as const;
export type BadgeGroup = (typeof BADGE_GROUPS)[number];

/** 数えの単位（表示の換算: 時間は秒 → 時間、距離は m → km） */
export type StatUnit = 'count' | 'hours' | 'km';

export interface BadgeStat {
  /** 段階の数えの id（表の badges.ladder.<id>） */
  readonly ladder: string;
  /** 合計する stats のキー */
  readonly keys: readonly string[];
  /** しきい値（stats の単位: 秒・m・数） */
  readonly goal: number;
  /** 表示のしきい値（時間・km・数） */
  readonly shown: number;
  readonly unit: StatUnit;
}

/** 組み合わせ（文の作り方。params は表の値の id） */
export interface BadgeCombo {
  readonly family: string;
  readonly params: Readonly<Record<string, string>>;
}

export interface BadgeDef {
  readonly id: string;
  readonly group: BadgeGroup;
  /** 段階ごとの報酬（CR。1 つなら段階なし、3 つなら銅・銀・金）。取ったときに 1 回だけ払う */
  readonly rewards: readonly number[];
  /** 補助の組「ふつう」以上（自動射撃・速度合わせ・狙いの補助「強」を使わない）で取ったときだけ */
  readonly skill?: boolean;
  /** 隠し勲章（取るまで名前と条件が「？？？」） */
  readonly hidden?: boolean;
  /** 段階の数え（9-10b） */
  readonly stat?: BadgeStat;
  /** 組み合わせ（9-10b） */
  readonly combo?: BadgeCombo;
  /** 集め: 集め以外の勲章のうち取った割合（0〜1） */
  readonly collect?: number;
}

/** 報酬（9-10b）: 新しい勲章は 1 つずつは小さく、10 個ごとの節目と集めでまとめて */
export const BADGE_REWARDS = {
  /** 9-10b で足した勲章 1 つ（段階の数え・組み合わせ） */
  each: 100,
  /** 勲章（集めも含む・段階付きは 1 つ）を milestoneEvery 個取るごと */
  milestoneEvery: 10,
  milestone: 500,
  /** 集めの割合ごと */
  collect: [
    { fraction: 0.25, credits: 1000 },
    { fraction: 0.5, credits: 2000 },
    { fraction: 0.75, credits: 4000 },
    { fraction: 1, credits: 8000 },
  ],
} as const;

interface LadderSpec {
  readonly id: string;
  readonly group: BadgeGroup;
  readonly keys: readonly string[];
  readonly steps: readonly number[];
  readonly unit?: StatUnit;
  /** 隠す段（しきい値。表示の単位） */
  readonly hidden?: readonly number[];
}

const AIRCRAFT_IDS = AIRCRAFT_MODELS.map((m) => m.id);

/** 段階の数えの表（steps は表示の単位: 時間・km・数） */
const LADDERS: readonly LadderSpec[] = [
  // 戦い（キャンペーン・レイド・防衛戦。フリーフライト・練習場は別の段）
  {
    id: 'kill',
    group: 'combat',
    keys: ['kill'],
    steps: [10, 50, 100, 250, 500, 1000, 2500],
    hidden: [2500],
  },
  { id: 'killGun', group: 'combat', keys: ['kill.w.gun'], steps: [50, 200, 1000] },
  { id: 'killMissile', group: 'combat', keys: ['kill.w.missile'], steps: [50, 200, 1000] },
  { id: 'killRocket', group: 'combat', keys: ['kill.w.rocket'], steps: [25, 100, 500] },
  { id: 'killBomb', group: 'combat', keys: ['kill.w.bomb'], steps: [25, 100, 500] },
  { id: 'killFighter', group: 'combat', keys: ['kill.t.fighter'], steps: [25, 100, 500] },
  { id: 'killBomber', group: 'combat', keys: ['kill.t.bomber'], steps: [10, 50, 200] },
  { id: 'killCruise', group: 'combat', keys: ['kill.t.cruise'], steps: [10, 50, 200] },
  { id: 'killGround', group: 'combat', keys: ['kill.t.ground'], steps: [25, 100, 500] },
  { id: 'killHard', group: 'combat', keys: ['kill.d.hard'], steps: [25, 100, 500] },
  { id: 'killFree', group: 'combat', keys: ['kill.m.free'], steps: [50, 250, 1000] },
  { id: 'noHit', group: 'combat', keys: ['clear.noHit'], steps: [5, 25, 100] },
  { id: 'noDown', group: 'combat', keys: ['clear.noDown'], steps: [10, 50, 200] },
  // 操縦（機動の回数）
  { id: 'mvLoop', group: 'flight', keys: ['mv.loop'], steps: [10, 50, 200, 1000], hidden: [1000] },
  { id: 'mvImmelmann', group: 'flight', keys: ['mv.immelmann'], steps: [10, 50, 200] },
  { id: 'mvLowPass', group: 'flight', keys: ['mv.lowPass'], steps: [10, 50, 200] },
  { id: 'mvInverted', group: 'flight', keys: ['mv.inverted'], steps: [10, 50, 200] },
  { id: 'mvTopSpeed', group: 'flight', keys: ['mv.topSpeed'], steps: [10, 50, 200] },
  // 通算（出撃・成功・飛行時間・距離・機体・補助の組）
  {
    id: 'sortie',
    group: 'career',
    keys: ['sortie'],
    steps: [10, 50, 100, 250, 500, 1000],
    hidden: [1000],
  },
  { id: 'win', group: 'career', keys: ['win'], steps: [10, 50, 100, 250, 500] },
  {
    id: 'time',
    group: 'career',
    keys: ['time'],
    steps: [1, 5, 10, 25, 50, 100],
    unit: 'hours',
    hidden: [100],
  },
  {
    id: 'dist',
    group: 'career',
    keys: ['dist'],
    steps: [100, 500, 1000, 5000, 10000, 50000],
    unit: 'km',
    hidden: [50000],
  },
  ...AIRCRAFT_IDS.map((id): LadderSpec => ({
    id: `ac.${id}`,
    group: 'career',
    keys: [`sortie.ac.${id}`],
    steps: [10, 50, 200],
  })),
  { id: 'winNormal', group: 'career', keys: ['win.a.normal', 'win.a.hard'], steps: [10, 50, 200] },
  { id: 'winHard', group: 'career', keys: ['win.a.hard'], steps: [10, 50, 200] },
  // モードごと
  { id: 'sortieMission', group: 'campaign', keys: ['sortie.m.mission'], steps: [10, 50, 100] },
  { id: 'sortieRaid', group: 'raid', keys: ['sortie.m.raid'], steps: [5, 25, 100] },
  { id: 'parts', group: 'raid', keys: ['kill.t.part'], steps: [10, 50, 200] },
  { id: 'sortieRace', group: 'race', keys: ['sortie.m.race'], steps: [10, 50, 200] },
  { id: 'ring', group: 'race', keys: ['ring'], steps: [100, 500, 1000, 5000], hidden: [5000] },
  { id: 'sortieDefense', group: 'defense', keys: ['sortie.m.defense'], steps: [5, 25, 100] },
  { id: 'waves', group: 'defense', keys: ['waves'], steps: [50, 200, 1000] },
  { id: 'sortiePractice', group: 'practice', keys: ['sortie.m.practice'], steps: [10, 50, 200] },
  {
    id: 'killTarget',
    group: 'practice',
    keys: ['kill.t.target'],
    steps: [100, 500, 2000],
    hidden: [2000],
  },
  {
    id: 'dailyDays',
    group: 'daily',
    keys: ['daily.days'],
    steps: [7, 30, 100, 365],
    hidden: [365],
  },
  // 協力・PvP（対戦の終わりの集計）
  {
    id: 'coopClear',
    group: 'coop',
    keys: ['coop.clear.2', 'coop.clear.3', 'coop.clear.4'],
    steps: [5, 25, 100],
  },
  { id: 'coop2', group: 'coop', keys: ['coop.clear.2'], steps: [3, 10] },
  { id: 'coop3', group: 'coop', keys: ['coop.clear.3'], steps: [3, 10] },
  { id: 'coop4', group: 'coop', keys: ['coop.clear.4'], steps: [3, 10] },
  { id: 'pvpPlay', group: 'pvp', keys: ['pvp.play'], steps: [10, 50, 200] },
  { id: 'pvpWin', group: 'pvp', keys: ['pvp.win'], steps: [5, 25, 100] },
  { id: 'pvpKill', group: 'pvp', keys: ['pvp.kill'], steps: [50, 100, 250, 1000], hidden: [1000] },
];

const UNIT_SCALE: Readonly<Record<StatUnit, number>> = { count: 1, hours: 3600, km: 1000 };

function ladderDefs(): BadgeDef[] {
  const out: BadgeDef[] = [];
  for (const l of LADDERS) {
    const unit = l.unit ?? 'count';
    for (const step of l.steps) {
      out.push({
        id: `l.${l.id}.${String(step)}`,
        group: l.group,
        rewards: [BADGE_REWARDS.each],
        ...(l.hidden?.includes(step) ? { hidden: true } : {}),
        stat: { ladder: l.id, keys: l.keys, goal: step * UNIT_SCALE[unit], shown: step, unit },
      });
    }
  }
  return out;
}

/** 組み合わせの勲章の id（判定と表で同じ作り方） */
export const comboId = {
  raidClear: (kaiju: string, diff: string) => `c.raidClear.${kaiju}.${diff}`,
  raidTimed: (kaiju: string, diff: string) => `c.raidTimed.${kaiju}.${diff}`,
  raidNoHit: (kaiju: string, diff: string) => `c.raidNoHit.${kaiju}.${diff}`,
  raidNoDown: (kaiju: string, diff: string) => `c.raidNoDown.${kaiju}.${diff}`,
  raidAssistHard: (kaiju: string, diff: string) => `c.raidAssistHard.${kaiju}.${diff}`,
  missionS: (mission: string, aircraft: string) => `c.missionS.${mission}.${aircraft}`,
  missionSAssist: (mission: string, assist: string) => `c.missionSAssist.${mission}.${assist}`,
  courseGold: (course: string, aircraft: string) => `c.courseGold.${course}.${aircraft}`,
  defenseClear: (map: string, diff: string) => `c.defenseClear.${map}.${diff}`,
} as const;

/** 補助の組の S を数える組（かんたんは S と同じなので数えない） */
export const MISSION_S_ASSISTS = ['normal', 'hard'] as const;

function comboDefs(): BadgeDef[] {
  const out: BadgeDef[] = [];
  const add = (
    id: string,
    group: BadgeGroup,
    family: string,
    params: Record<string, string>,
    extra: Partial<BadgeDef> = {},
  ): void => {
    out.push({ id, group, rewards: [BADGE_REWARDS.each], combo: { family, params }, ...extra });
  };
  // 怪獣 × 難易度 × 条件（クリア・時間内は記録からさかのぼれる。無傷・撃墜されず・補助むずかしいは飛行の終わりに判定）
  for (const kaiju of RAID_KAIJU_IDS) {
    for (const diff of RAID_DIFFICULTIES) {
      const p = { kaiju, diff };
      const hard = diff === 'hard';
      add(comboId.raidClear(kaiju, diff), 'raid', 'raidClear', p);
      add(comboId.raidTimed(kaiju, diff), 'raid', 'raidTimed', p);
      add(comboId.raidNoHit(kaiju, diff), 'raid', 'raidNoHit', p, {
        skill: true,
        ...(hard ? { hidden: true } : {}),
      });
      add(comboId.raidNoDown(kaiju, diff), 'raid', 'raidNoDown', p, { skill: true });
      add(
        comboId.raidAssistHard(kaiju, diff),
        'raid',
        'raidAssistHard',
        p,
        hard ? { hidden: true } : {},
      );
    }
  }
  // ミッション × 機体・補助の組で S
  for (const m of MISSIONS) {
    for (const ac of AIRCRAFT_IDS)
      add(comboId.missionS(m.id, ac), 'campaign', 'missionS', { mission: m.id, aircraft: ac });
    for (const a of MISSION_S_ASSISTS)
      add(comboId.missionSAssist(m.id, a), 'campaign', 'missionSAssist', {
        mission: m.id,
        assist: a,
      });
  }
  // コース × 機体でゴールド（S）
  for (const c of COURSES)
    for (const ac of AIRCRAFT_IDS)
      add(comboId.courseGold(c.id, ac), 'race', 'courseGold', { course: c.id, aircraft: ac });
  // 防衛戦のマップ × 難易度で 10 波（記録からさかのぼれる）
  for (const m of DEFENSE_MAPS)
    for (const diff of DEFENSE_DIFFICULTIES)
      add(comboId.defenseClear(m.mapId, diff), 'defense', 'defenseClear', { map: m.mapId, diff });
  return out;
}

function collectDefs(): BadgeDef[] {
  return BADGE_REWARDS.collect.map((c) => ({
    id: `collect.${String(Math.round(c.fraction * 100))}`,
    group: 'collect' as const,
    rewards: [c.credits],
    collect: c.fraction,
    ...(c.fraction >= 1 ? { hidden: true } : {}),
  }));
}

/** 9-10b で足した勲章（段階の数え・組み合わせ・集め） */
export const EXTRA_BADGES: readonly BadgeDef[] = [
  ...ladderDefs(),
  ...comboDefs(),
  ...collectDefs(),
];
