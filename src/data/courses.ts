// リングレース（7-1）のコース定義（データだけ。型は src/missions/race/types.ts、進行は src/missions/race/runner.ts）。
// 座標は m（北 −Z・南 +Z・東 +X）。向きは通り抜ける方位（0 = 北、90 = 東）と上向きの角度（度）。
// 保証条件（tests/race-course.test.ts）: リングは地表 30m 以上・前のリング（1 個目は開始位置）から見える・
// 連続するリングの間の必要旋回率が全機体（未強化）の最大ピッチ角速度の 80% 以下。
// ゴールドタイムは道筋を追うボット（Kestrel・未強化・スロットル全開・アフターバーナーはブーストだけ）のタイム ÷ 1.2 を
// 0.5 秒に丸めた値（tests/race-bot.test.ts。ボットはランク B）。制限時間はゴールドタイムの約 3 倍
import { t } from '../core/i18n';
import type { CourseDef } from '../missions/race/types';

/** 海岸周回: 島を半径 3300m で反時計回りに 1 周する低空（高度 70〜130m）の入門コース */
export const COAST_COURSE: CourseDef = {
  id: 'coast',
  get name() {
    return t('courses.coast.name');
  },
  get note() {
    return t('courses.coast.note');
  },
  get level() {
    return t('courses.level.beginner');
  },
  mapId: 'island',
  weatherId: 'day-clear',
  start: { x: 0, y: 100, z: 3300, headingDeg: 90 },
  rings: [
    { x: 1395, y: 90, z: 2991, headingDeg: 64, pitchDeg: -1, kind: 'normal' },
    { x: 2703, y: 70, z: 1893, headingDeg: 35, pitchDeg: 0, kind: 'thin' },
    { x: 3287, y: 110, z: 288, headingDeg: 5, pitchDeg: 0, kind: 'normal' },
    { x: 2991, y: 80, z: -1395, headingDeg: -25, pitchDeg: 0, kind: 'checkpoint' },
    { x: 1893, y: 130, z: -2703, headingDeg: -55, pitchDeg: 0, kind: 'normal' },
    { x: 288, y: 100, z: -3287, headingDeg: -85, pitchDeg: -1, kind: 'boost' },
    { x: -1395, y: 70, z: -2991, headingDeg: -115, pitchDeg: 0, kind: 'normal' },
    { x: -2703, y: 90, z: -1893, headingDeg: -145, pitchDeg: 1, kind: 'checkpoint' },
    { x: -3287, y: 120, z: -288, headingDeg: -175, pitchDeg: 0, kind: 'normal' },
    { x: -2991, y: 80, z: 1395, headingDeg: 155, pitchDeg: 0, kind: 'thin' },
    { x: -1893, y: 100, z: 2703, headingDeg: 125, pitchDeg: 0, kind: 'normal' },
    { x: -288, y: 90, z: 3287, headingDeg: 110, pitchDeg: 0, kind: 'checkpoint' },
  ],
  timeLimitSeconds: 150,
  goldTimeSeconds: 48,
};

/**
 * 渓谷スラローム: 島の北の山腹を地表 60〜90m で左右に縫い、山腹を東へ横切って北の海へ下り、
 * 西の海岸沿いを南へ下りる中級コース（7-2 の事前修正で 18 → 24 個）
 */
export const CANYON_COURSE: CourseDef = {
  id: 'canyon',
  get name() {
    return t('courses.canyon.name');
  },
  get note() {
    return t('courses.canyon.note');
  },
  get level() {
    return t('courses.level.intermediate');
  },
  mapId: 'island',
  weatherId: 'day-clear',
  start: { x: -700, y: 150, z: -3600, headingDeg: 180 },
  rings: [
    { x: -640, y: 110, z: -2800, headingDeg: -174, pitchDeg: -2, kind: 'boost' },
    { x: -760, y: 103, z: -2400, headingDeg: -180, pitchDeg: 2, kind: 'normal' },
    { x: -640, y: 133, z: -2000, headingDeg: 180, pitchDeg: 6, kind: 'thin' },
    { x: -760, y: 183, z: -1600, headingDeg: 180, pitchDeg: 12, kind: 'normal' },
    { x: -640, y: 294, z: -1220, headingDeg: 144, pitchDeg: 13, kind: 'checkpoint' },
    { x: -330, y: 360, z: -1000, headingDeg: 102, pitchDeg: 9, kind: 'normal' },
    { x: 80, y: 411, z: -1080, headingDeg: 92, pitchDeg: 0, kind: 'thin' },
    { x: 480, y: 363, z: -980, headingDeg: 84, pitchDeg: -9, kind: 'normal' },
    { x: 830, y: 297, z: -1150, headingDeg: 46, pitchDeg: -11, kind: 'checkpoint' },
    { x: 1000, y: 226, z: -1470, headingDeg: 8, pitchDeg: -10, kind: 'normal' },
    { x: 920, y: 173, z: -1850, headingDeg: 3, pitchDeg: -8, kind: 'normal' },
    { x: 1040, y: 121, z: -2230, headingDeg: 0, pitchDeg: -5, kind: 'normal' },
    { x: 920, y: 104, z: -2610, headingDeg: -3, pitchDeg: -3, kind: 'normal' },
    { x: 1000, y: 75, z: -2990, headingDeg: -4, pitchDeg: -3, kind: 'checkpoint' },
    { x: 880, y: 60, z: -3320, headingDeg: -49, pitchDeg: -1, kind: 'normal' },
    { x: 400, y: 60, z: -3420, headingDeg: -95, pitchDeg: 0, kind: 'boost' },
    { x: -100, y: 60, z: -3220, headingDeg: -126, pitchDeg: 2, kind: 'normal' },
    { x: -400, y: 98, z: -2870, headingDeg: -136, pitchDeg: 3, kind: 'checkpoint' },
    // 7-2 の事前修正: 西の海岸沿いを南へ縫う 6 個を足して 24 個に（ボット 34.65 秒）
    { x: -950, y: 120, z: -2350, headingDeg: -132, pitchDeg: 1, kind: 'normal' },
    { x: -1550, y: 115, z: -1850, headingDeg: -135, pitchDeg: -1, kind: 'thin' },
    { x: -2150, y: 100, z: -1150, headingDeg: -152, pitchDeg: 0, kind: 'checkpoint' },
    { x: -2350, y: 105, z: -350, headingDeg: -164, pitchDeg: 0, kind: 'boost' },
    { x: -2650, y: 105, z: 550, headingDeg: 171, pitchDeg: 0, kind: 'normal' },
    { x: -1950, y: 90, z: 2050, headingDeg: 155, pitchDeg: 0, kind: 'checkpoint' },
  ],
  timeLimitSeconds: 90,
  goldTimeSeconds: 29,
};

/**
 * 港湾ハイスピード: 湾から岸壁を越え、タワー群の間（x = −51 の道路の上、幅 52m）を細いリングで抜け、
 * 北の山を回って街の屋根の上を湾へ戻る上級コース
 */
export const HARBOR_COURSE: CourseDef = {
  id: 'harbor-speed',
  get name() {
    return t('courses.harborSpeed.name');
  },
  get note() {
    return t('courses.harborSpeed.note');
  },
  get level() {
    return t('courses.level.advanced');
  },
  mapId: 'harbor',
  weatherId: 'day-clear',
  start: { x: 0, y: 90, z: 3600, headingDeg: 0 },
  rings: [
    { x: 0, y: 70, z: 3000, headingDeg: -11, pitchDeg: -2, kind: 'normal' },
    { x: -200, y: 60, z: 2500, headingDeg: 7, pitchDeg: -1, kind: 'normal' },
    { x: 120, y: 60, z: 2050, headingDeg: 4, pitchDeg: 1, kind: 'thin' },
    { x: -60, y: 75, z: 1700, headingDeg: -13, pitchDeg: 1, kind: 'boost' },
    { x: -51, y: 80, z: 1250, headingDeg: 1, pitchDeg: 0, kind: 'normal' },
    { x: -51, y: 80, z: 950, headingDeg: 0, pitchDeg: 0, kind: 'thin' },
    { x: -51, y: 80, z: 650, headingDeg: 0, pitchDeg: 1, kind: 'thin' },
    { x: -51, y: 85, z: 380, headingDeg: -21, pitchDeg: 1, kind: 'checkpoint' },
    { x: -400, y: 90, z: 0, headingDeg: -44, pitchDeg: 1, kind: 'normal' },
    { x: -900, y: 110, z: -500, headingDeg: -39, pitchDeg: 2, kind: 'normal' },
    { x: -1300, y: 150, z: -1100, headingDeg: -10, pitchDeg: 2, kind: 'normal' },
    { x: -1100, y: 146, z: -1900, headingDeg: 36, pitchDeg: 2, kind: 'normal' },
    { x: -400, y: 195, z: -2350, headingDeg: 75, pitchDeg: 2, kind: 'checkpoint' },
    { x: 400, y: 205, z: -2300, headingDeg: 112, pitchDeg: -2, kind: 'boost' },
    { x: 1000, y: 133, z: -1800, headingDeg: 148, pitchDeg: -3, kind: 'normal' },
    { x: 1200, y: 120, z: -1000, headingDeg: -175, pitchDeg: -2, kind: 'checkpoint' },
    { x: 900, y: 85, z: -300, headingDeg: -159, pitchDeg: -2, kind: 'normal' },
    { x: 650, y: 80, z: 400, headingDeg: -162, pitchDeg: -1, kind: 'thin' },
    { x: 450, y: 70, z: 1100, headingDeg: -158, pitchDeg: -1, kind: 'normal' },
    { x: 0, y: 50, z: 1950, headingDeg: -152, pitchDeg: -1, kind: 'checkpoint' },
  ],
  timeLimitSeconds: 75,
  goldTimeSeconds: 25,
};

/**
 * 夕空アクロバット: 島の東の海の上で、宙返り（半径 550m）→ インメルマン（上昇の半宙返りで反転）→
 * スプリット S（降下の半宙返りで反転）→ 上下のスラローム。縦の配置で、背面からのロールを要求する
 */
export const ACRO_COURSE: CourseDef = {
  id: 'acro',
  get name() {
    return t('courses.acro.name');
  },
  get note() {
    return t('courses.acro.note');
  },
  get level() {
    return t('courses.level.advanced');
  },
  mapId: 'island',
  weatherId: 'evening-clear',
  start: { x: 4200, y: 350, z: 3200, headingDeg: 0 },
  rings: [
    { x: 4200, y: 350, z: 2500, headingDeg: 0, pitchDeg: 0, kind: 'boost' },
    { x: 4200, y: 350, z: 1500, headingDeg: 0, pitchDeg: 23, kind: 'normal' },
    { x: 4200, y: 900, z: 950, headingDeg: 0, pitchDeg: 90, kind: 'normal' },
    { x: 4200, y: 1450, z: 1500, headingDeg: 180, pitchDeg: 0, kind: 'thin' },
    { x: 4200, y: 900, z: 2050, headingDeg: 180, pitchDeg: -79, kind: 'normal' },
    { x: 4200, y: 511, z: 1889, headingDeg: 0, pitchDeg: -38, kind: 'normal' },
    { x: 4200, y: 350, z: 700, headingDeg: 0, pitchDeg: 19, kind: 'normal' },
    { x: 4200, y: 850, z: 200, headingDeg: 0, pitchDeg: 90, kind: 'normal' },
    { x: 4200, y: 1350, z: 700, headingDeg: 157, pitchDeg: 18, kind: 'checkpoint' },
    { x: 4700, y: 1200, z: 1300, headingDeg: 134, pitchDeg: -12, kind: 'normal' },
    { x: 5200, y: 1050, z: 1700, headingDeg: 150, pitchDeg: -32, kind: 'normal' },
    { x: 5200, y: 650, z: 2100, headingDeg: 0, pitchDeg: -90, kind: 'normal' },
    { x: 5200, y: 250, z: 1700, headingDeg: 0, pitchDeg: -13, kind: 'checkpoint' },
    { x: 5200, y: 480, z: 1000, headingDeg: 0, pitchDeg: -1, kind: 'boost' },
    { x: 5200, y: 250, z: 400, headingDeg: 0, pitchDeg: -1, kind: 'thin' },
    { x: 5200, y: 450, z: -200, headingDeg: 0, pitchDeg: 18, kind: 'checkpoint' },
  ],
  timeLimitSeconds: 80,
  goldTimeSeconds: 27,
};

/**
 * 9-8 夜景クルーズ: 港湾都市の夜、湾から東の岸沿いを北へ、山すその手前で街の北を西へ横切り、西の岸沿いを湾へ戻る入門コース。
 * リングは広い（半径 60m）・曲がりはゆるい・高さは 160〜230m（建物より十分上）
 */
export const NIGHT_HARBOR_COURSE: CourseDef = {
  id: 'night-harbor',
  get name() {
    return t('courses.nightHarbor.name');
  },
  get note() {
    return t('courses.nightHarbor.note');
  },
  get level() {
    return t('courses.level.beginner');
  },
  mapId: 'harbor',
  weatherId: 'night-clear',
  start: { x: 0, y: 200, z: 4300, headingDeg: 0 },
  rings: [
    { x: 0, y: 185, z: 3400, headingDeg: 20, pitchDeg: 0, kind: 'normal', radius: 60 },
    { x: 900, y: 175, z: 2800, headingDeg: 50, pitchDeg: 0, kind: 'normal', radius: 60 },
    { x: 1800, y: 170, z: 2000, headingDeg: 15, pitchDeg: 0, kind: 'thin', radius: 60 },
    { x: 2000, y: 180, z: 900, headingDeg: 0, pitchDeg: 0, kind: 'normal', radius: 60 },
    { x: 2000, y: 190, z: -300, headingDeg: -10, pitchDeg: 1, kind: 'boost', radius: 60 },
    { x: 1500, y: 215, z: -1400, headingDeg: -45, pitchDeg: 1, kind: 'checkpoint', radius: 60 },
    { x: 500, y: 230, z: -1900, headingDeg: -80, pitchDeg: 0, kind: 'normal', radius: 60 },
    { x: -700, y: 230, z: -1900, headingDeg: -105, pitchDeg: 0, kind: 'normal', radius: 60 },
    { x: -1700, y: 215, z: -1300, headingDeg: -145, pitchDeg: -1, kind: 'normal', radius: 60 },
    { x: -2000, y: 200, z: -200, headingDeg: 178, pitchDeg: -1, kind: 'checkpoint', radius: 60 },
    { x: -2000, y: 185, z: 1000, headingDeg: 175, pitchDeg: 0, kind: 'boost', radius: 60 },
    { x: -1700, y: 175, z: 2100, headingDeg: 150, pitchDeg: 0, kind: 'thin', radius: 60 },
    { x: -800, y: 170, z: 2900, headingDeg: 115, pitchDeg: 0, kind: 'normal', radius: 60 },
    { x: 200, y: 165, z: 3250, headingDeg: 95, pitchDeg: 0, kind: 'checkpoint', radius: 60 },
  ],
  timeLimitSeconds: 110,
  goldTimeSeconds: 36.5,
};

/**
 * 9-8 峰のらせん: 島の夜明け、南の海から南の浜を越え、中央の峰の周りを反時計回りに登るらせん（高度 380〜700m）、
 * 峰の肩を越えて南東の斜面を下り、南の海の上を低く西へ抜ける中級コース
 */
export const SPIRAL_COURSE: CourseDef = {
  id: 'peak-spiral',
  get name() {
    return t('courses.peakSpiral.name');
  },
  get note() {
    return t('courses.peakSpiral.note');
  },
  get level() {
    return t('courses.level.intermediate');
  },
  mapId: 'island',
  weatherId: 'dawn-clear',
  start: { x: 0, y: 220, z: 4300, headingDeg: 0 },
  rings: [
    { x: 0, y: 230, z: 3300, headingDeg: 10, pitchDeg: 3, kind: 'boost' },
    { x: 350, y: 300, z: 2400, headingDeg: 25, pitchDeg: 6, kind: 'normal' },
    { x: 1000, y: 400, z: 1650, headingDeg: 30, pitchDeg: 6, kind: 'thin' },
    { x: 1700, y: 460, z: 700, headingDeg: -5, pitchDeg: 4, kind: 'normal' },
    { x: 1500, y: 520, z: -800, headingDeg: -40, pitchDeg: 4, kind: 'checkpoint' },
    { x: 400, y: 590, z: -1650, headingDeg: -80, pitchDeg: 3, kind: 'normal' },
    { x: -1000, y: 650, z: -1350, headingDeg: -130, pitchDeg: 2, kind: 'thin' },
    { x: -1700, y: 700, z: -100, headingDeg: 175, pitchDeg: 0, kind: 'checkpoint' },
    { x: -500, y: 760, z: 550, headingDeg: 115, pitchDeg: -4, kind: 'normal' },
    { x: 750, y: 580, z: 1250, headingDeg: 135, pitchDeg: -12, kind: 'normal' },
    { x: 1500, y: 320, z: 2150, headingDeg: 160, pitchDeg: -12, kind: 'checkpoint' },
    { x: 1200, y: 120, z: 3200, headingDeg: -150, pitchDeg: -4, kind: 'normal' },
    { x: 100, y: 90, z: 3700, headingDeg: -100, pitchDeg: 0, kind: 'thin' },
    { x: -1200, y: 100, z: 3500, headingDeg: -70, pitchDeg: 0, kind: 'checkpoint' },
  ],
  timeLimitSeconds: 120,
  goldTimeSeconds: 40,
};

/** コース一覧の並び順 */
export const COURSES: readonly CourseDef[] = [
  COAST_COURSE,
  CANYON_COURSE,
  HARBOR_COURSE,
  ACRO_COURSE,
  NIGHT_HARBOR_COURSE,
  SPIRAL_COURSE,
];

export function findCourse(id: string): CourseDef | null {
  return COURSES.find((c) => c.id === id) ?? null;
}
