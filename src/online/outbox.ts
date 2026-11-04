// 記録の差し出し口（7-4、DOM・Supabase 非依存）: ゲームの各モード（レース・レイド・防衛戦）は記録をここへ出すだけ。
// オンライン連携を読み込んだとき（環境変数があるときだけ）に送り先がつながる。つながっていなければ何もしない
import { ONLINE_CLIENT_VERSION } from '../data/online';
import type { RecordInput } from './records';

export class RecordOutbox {
  private target: ((r: RecordInput) => void) | null = null;

  connect(fn: (r: RecordInput) => void): void {
    this.target = fn;
  }

  submit(r: RecordInput): void {
    this.target?.(r);
  }
}

export const recordOutbox = new RecordOutbox();

/** レースのゴール（完走だけ。時間切れは null） */
export function raceRecord(
  r: { courseId: string; outcome: string; time: number; missed: number; thinPassed: number },
  aircraftId: string,
): RecordInput | null {
  if (r.outcome !== 'finished') return null;
  return {
    kind: 'race',
    key: r.courseId,
    aircraftId,
    valueMs: Math.round(r.time * 1000),
    detail: { missed: r.missed, thin: r.thinPassed },
    clientVersion: ONLINE_CLIENT_VERSION,
  };
}

/** ソロのレイドのクリア。key は難易度（ヴォルガス）か「怪獣:難易度」（9-6c。src/data/raid-kaiju.ts の raidRecordKey） */
export function raidRecord(
  key: string,
  elapsedSeconds: number,
  aircraftId: string,
  rank: string | null,
): RecordInput {
  return {
    kind: 'raid',
    key,
    aircraftId,
    valueMs: Math.round(elapsedSeconds * 1000),
    detail: rank ? { rank } : {},
    clientVersion: ONLINE_CLIENT_VERSION,
  };
}

/** ソロの防衛戦の終わり（成功・陥落とも） */
export function defenseRecord(
  s: {
    mapId: string;
    difficulty: string;
    outcome: string;
    wavesCleared: number;
    hqHp: number;
    hqMaxHp: number;
    kills: number;
  },
  elapsedSeconds: number,
  aircraftId: string,
): RecordInput {
  const hq = s.hqMaxHp > 0 ? Math.round((Math.max(0, s.hqHp) / s.hqMaxHp) * 100) : 0;
  return {
    kind: 'defense',
    key: `${s.mapId}:${s.difficulty}`,
    aircraftId,
    valueMs: Math.max(1, Math.round(elapsedSeconds * 1000)),
    detail: {
      waves: s.wavesCleared,
      hq: Math.min(100, hq),
      kills: s.kills,
      cleared: s.outcome === 'cleared',
    },
    clientVersion: ONLINE_CLIENT_VERSION,
  };
}
