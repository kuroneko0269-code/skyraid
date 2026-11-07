// チュートリアル（4-11 → 9-5c で章に分けた）の定義。章ごとに練習のミッション（失敗しない）を 1 本、目標を順に進める。
// 目標の種類 task（data/tutorial-tasks.ts）の判定は src/missions/tutorial/coach.ts。指示・ヒントの文は src/data/i18n/*.json の
// tutorial.chapters、図は src/ui/tutorial-figure.ts。距離は m、北は -Z、向きは -Z から右回り。島の山（最高 約 600m）より上を飛ぶ
import type { MissionDef, ObjectiveDef, Pose, SpawnDef } from '../missions/types';
import { PRACTICE_CONFIG } from './practice';

/** 光らせられるタッチ操作の部品（src/ui/touch-controls.ts） */
export const TOUCH_PARTS = ['stick', 'yaw', 'throttle', 'ab', 'msl', 'flr', 'gun'] as const;
export type TouchPart = (typeof TOUCH_PARTS)[number];

/** 章（この順に並べる。assist は飛ばない章 = 補助の設定と練習場の案内） */
export const TUTORIAL_CHAPTERS = [
  'steer',
  'speed',
  'gun',
  'moving',
  'missile',
  'flare',
  'loop',
  'find',
  'assist',
] as const;
export type TutorialChapter = (typeof TUTORIAL_CHAPTERS)[number];

/** 図の種類（src/ui/tutorial-figure.ts。操作の方式ごとに描き分ける） */
export const TUTORIAL_FIGURES = [
  'steer',
  'release',
  'climb',
  'throttle',
  'ab',
  'follow',
  'aim',
  'fire',
  'lead',
  'missile',
  'resupply',
  'rocket',
  'flare',
  'loop',
  'reverse',
  'select',
  'behind',
] as const;
export type TutorialFigure = (typeof TUTORIAL_FIGURES)[number];

/** 章の 1 段階（目標 1 つ）の表示: 光らせる部品と図 */
export interface TutorialStepView {
  readonly highlight: readonly TouchPart[];
  readonly figure: TutorialFigure;
}

export interface TutorialChapterDef {
  readonly id: TutorialChapter;
  /** 飛ぶ章のミッション（assist は null） */
  readonly mission: MissionDef | null;
  /** 目標の id → 表示 */
  readonly steps: Readonly<Record<string, TutorialStepView>>;
}

export const TUTORIAL_CONFIG = {
  /** チュートリアルを初めて終えた（飛ぶ章をすべて終えた）ときだけもらえるクレジット（4-11 と同じ） */
  rewardCredits: 500,
  /** 段階が始まってからこの秒数で達成していなければ、段階のヒントを出す */
  stepHintSeconds: 20,
  /** 飛行中の一言（追い越した・射程外で撃った・見失った・速さが足りない・ミサイルに当たった）を出す秒数 */
  tipSeconds: 4,
  /** ミサイルの章の補充（キャンペーンは 8 秒。撃ち尽くすのを待たせない） */
  missileResupplySeconds: 5,
  /**
   * タッチ操作のヒント（フリーフライト・ミッションの初回）: 指す HUD の要素（CSS セレクタ）を順に、1 つ hintSeconds 秒。
   * 文は i18n の tutorial.hints[id]。飛行が始まって hintDelaySeconds 秒後から
   */
  hints: [
    { id: 'speed', selector: '.hud-left .hud-box' },
    { id: 'altitude', selector: '.hud-right .hud-box' },
    { id: 'radar', selector: '.hud-radar' },
    { id: 'ammo', selector: '.hud-ammo' },
  ],
  hintSeconds: 3,
  hintDelaySeconds: 1,
} as const;

/** チュートリアルのミッションの id の頭（tutorial-steer など） */
export const TUTORIAL_MISSION_PREFIX = 'tutorial-';

/** 北の沖から南向き（島の上へ） */
const NORTH: Pose = { x: 0, y: 900, z: -3600, headingDeg: 180 };
/** 南の沖から北向き（島の上へ） */
const SOUTH: Pose = { x: 0, y: 850, z: 5200, headingDeg: 0 };

function mission(
  chapter: TutorialChapter,
  start: Pose,
  objectives: readonly ObjectiveDef[],
  spawns: readonly SpawnDef[] = [],
  extra: Partial<MissionDef> = {},
): MissionDef {
  return {
    id: `${TUTORIAL_MISSION_PREFIX}${chapter}`,
    mapId: 'island',
    start,
    parTimeSeconds: 120,
    practice: true,
    spawns,
    objectives: objectives.map((o, i) => ({
      ...o,
      start: i === 0 ? 'withPrevious' : 'afterPrevious',
    })),
    success: 'allRequiredObjectives',
    failConditions: [],
    reward: { baseCredits: 0 },
    ...extra,
  };
}

const task = (
  id: string,
  t: Extract<ObjectiveDef, { type: 'task' }>['task'],
  count = 1,
): ObjectiveDef => ({ id, type: 'task', task: t, count, required: true, start: 'afterPrevious' });

const view = (figure: TutorialFigure, ...highlight: TouchPart[]): TutorialStepView => ({
  figure,
  highlight,
});

export const TUTORIAL_CHAPTER_DEFS: Readonly<Record<TutorialChapter, TutorialChapterDef>> = {
  steer: {
    id: 'steer',
    mission: mission('steer', NORTH, [
      {
        id: 'rings',
        type: 'rings',
        required: true,
        start: 'withPrevious',
        // 直進・左へ 28°・右へ 56°（4-11 の 45° の曲がりを 1.3km で抜ける並びより間を空けた）
        rings: [
          { x: 0, y: 900, z: -2600, headingDeg: 180 },
          { x: -700, y: 900, z: -1300, headingDeg: 208 },
          { x: 0, y: 900, z: 0, headingDeg: 152 },
        ],
      },
      task('level', 'level'),
      task('climb', 'climb', 2),
    ]),
    steps: {
      rings: view('steer', 'stick'),
      level: view('release', 'stick'),
      climb: view('climb', 'stick'),
    },
  },
  speed: {
    id: 'speed',
    mission: mission('speed', NORTH, [
      { id: 'ab', type: 'speed', speed: 360, required: true, start: 'afterPrevious' },
      task('slow', 'slow'),
      task('follow', 'follow', 4),
    ]),
    steps: {
      ab: view('ab', 'throttle', 'ab'),
      slow: view('throttle', 'throttle'),
      follow: view('follow', 'throttle'),
    },
  },
  gun: {
    id: 'gun',
    mission: mission(
      'gun',
      { x: 0, y: 500, z: 5200, headingDeg: 0 },
      [
        task('aim', 'aim'),
        {
          id: 'targets',
          type: 'kill',
          target: 'target',
          count: 2,
          required: true,
          start: 'afterPrevious',
        },
      ],
      [{ kind: 'targets', count: 3, respawns: true, trigger: { type: 'start' } }],
    ),
    steps: { aim: view('aim', 'stick'), targets: view('fire', 'gun') },
  },
  moving: {
    id: 'moving',
    mission: mission(
      'moving',
      SOUTH,
      [
        {
          id: 'drones',
          type: 'kill',
          target: 'drone',
          count: 1,
          required: true,
          start: 'withPrevious',
        },
      ],
      [
        {
          kind: 'drones',
          count: PRACTICE_CONFIG.dronePaths.length,
          paths: PRACTICE_CONFIG.dronePaths,
          respawns: true,
          trigger: { type: 'start' },
        },
      ],
    ),
    steps: { drones: view('lead', 'gun', 'throttle') },
  },
  missile: {
    id: 'missile',
    mission: mission(
      'missile',
      { x: 0, y: 900, z: 5600, headingDeg: 0 },
      [
        task('lock', 'lock'),
        task('launch', 'launch'),
        task('resupply', 'resupply'),
        // 10-4b: ロケットへの切り替え（タッチは MSL の長押し・キーボードは別のキー・パッドは X）を体験する
        task('rocket', 'rocket'),
      ],
      [{ kind: 'drones', count: 3, respawns: true, trigger: { type: 'start' } }],
      { missileResupplySeconds: TUTORIAL_CONFIG.missileResupplySeconds },
    ),
    steps: {
      lock: view('missile', 'stick'),
      launch: view('missile', 'msl'),
      resupply: view('resupply', 'msl'),
      rocket: view('rocket', 'msl'),
    },
  },
  flare: {
    id: 'flare',
    mission: mission('flare', { x: 0, y: 1200, z: 4500, headingDeg: 0 }, [
      task('flare', 'flare', 2),
    ]),
    steps: { flare: view('flare', 'flr') },
  },
  loop: {
    id: 'loop',
    mission: mission('loop', { x: 0, y: 1100, z: -3600, headingDeg: 180 }, [
      task('loopTop', 'loopTop'),
      task('reverse', 'reverse'),
    ]),
    steps: {
      loopTop: view('loop', 'stick', 'ab'),
      reverse: view('reverse', 'stick'),
    },
  },
  find: {
    id: 'find',
    mission: mission(
      'find',
      SOUTH,
      [task('select', 'select', 2), task('behind', 'behind', 2)],
      [
        {
          kind: 'drones',
          count: PRACTICE_CONFIG.dronePaths.length,
          paths: PRACTICE_CONFIG.dronePaths,
          respawns: true,
          trigger: { type: 'start' },
        },
      ],
    ),
    steps: { select: view('select'), behind: view('behind', 'stick') },
  },
  assist: { id: 'assist', mission: null, steps: {} },
};

/** 飛ぶ章（すべて終えるとチュートリアルの完了 = 初回の報酬） */
export const TUTORIAL_FLIGHT_CHAPTERS: readonly TutorialChapter[] = TUTORIAL_CHAPTERS.filter(
  (c) => TUTORIAL_CHAPTER_DEFS[c].mission !== null,
);

export function isTutorialChapter(v: unknown): v is TutorialChapter {
  return typeof v === 'string' && (TUTORIAL_CHAPTERS as readonly string[]).includes(v);
}

/** ミッションの id → 章（チュートリアルでなければ null） */
export function tutorialChapterOf(missionId: string | undefined): TutorialChapter | null {
  if (!missionId?.startsWith(TUTORIAL_MISSION_PREFIX)) return null;
  const c = missionId.slice(TUTORIAL_MISSION_PREFIX.length);
  return isTutorialChapter(c) ? c : null;
}

/** 次の章（最後なら null） */
export function nextTutorialChapter(c: TutorialChapter): TutorialChapter | null {
  return TUTORIAL_CHAPTERS[TUTORIAL_CHAPTERS.indexOf(c) + 1] ?? null;
}
