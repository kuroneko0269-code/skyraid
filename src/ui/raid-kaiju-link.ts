// 10-2: レイドの怪獣ごとの遅延チャンクの口（一本化）。登録簿（src/data/raid-kaiju.ts）で lazy の怪獣は、入口のモジュール
// （ネフィルガは kaiju2-link.ts）が起動時に registerRaidKaijuChunk で読み方を登録する。モード選択・リプレイ・協力は
// 怪獣の id だけでここを呼ぶ（怪獣ごとの if を書かない）。読むのは使う直前と、怪獣選びで選んだときの先読みだけ
// （起動の量の上限 10-1 を上げない）
import { raidMission } from '../data/missions-special';
import type { RaidDifficulty } from '../data/raid';
import { NEPHIRGA_ID, findRaidKaiju, raidKaijuOf } from '../data/raid-kaiju';
import { findRaidVariant } from '../missions/raid-variants';
import type { MissionDef } from '../missions/types';

export interface RaidKaijuChunk {
  /** 読む（読み込み中・失敗の表示付き）。読めたら true */
  load(): Promise<boolean>;
  /** 先読み（表示なし） */
  prefetch(): void;
}

const chunks = new Map<string, RaidKaijuChunk>();

export function registerRaidKaijuChunk(id: string, chunk: RaidKaijuChunk): void {
  chunks.set(id, chunk);
}

/** 始める前に遅延チャンクを読む必要があるか（登録簿で lazy の怪獣） */
export function needsRaidKaijuChunk(kaiju: string | undefined): boolean {
  return findRaidKaiju(kaiju)?.lazy === true;
}

/**
 * 怪獣の遅延チャンクを読む。要らなければすぐ true。lazy なのに読み方が登録されていない（入口の登録漏れ）・読めないときは false
 * （呼ぶ側は始めない）
 */
export function loadRaidKaiju(kaiju: string | undefined): Promise<boolean> {
  if (!needsRaidKaijuChunk(kaiju)) return Promise.resolve(true);
  const c = kaiju === undefined ? undefined : chunks.get(kaiju);
  return c ? c.load() : Promise.resolve(false);
}

/** 先読み（怪獣選びで選んだとき） */
export function prefetchRaidKaiju(kaiju: string | undefined): void {
  if (!needsRaidKaijuChunk(kaiju) || kaiju === undefined) return;
  chunks.get(kaiju)?.prefetch();
}

/** 10-3b: 協力のロビーで差し込み口の怪獣（アルビオン）の遅延チャンクを先読み（ネフィルガは今までどおり飛行の始めに読む） */
export function prefetchCoopKaiju(index: number): void {
  const kaiju = raidKaijuOf(index);
  if (kaiju !== NEPHIRGA_ID) prefetchRaidKaiju(kaiju);
}

/** ソロのレイドのミッション（ヴォルガスは本体、ほかは登録されたレイドの怪獣。raid-variants.ts） */
export function soloRaidMission(kaiju: string | undefined, difficulty: RaidDifficulty): MissionDef {
  return findRaidVariant(kaiju)?.mission(difficulty) ?? raidMission(difficulty);
}

/**
 * ソロのレイドのミッションを用意して go に渡す（モード選択から）。遅延チャンクの怪獣は読んでから（読めない・読む間に
 * モード選択を離れたら渡さない）
 */
export function withSoloRaid(
  kaiju: string | undefined,
  difficulty: RaidDifficulty,
  game: { readonly state: string },
  go: (def: MissionDef) => void,
): void {
  const stillHere = (): boolean => game.state === 'mode_select';
  if (!needsRaidKaijuChunk(kaiju)) {
    go(soloRaidMission(kaiju, difficulty));
    return;
  }
  void loadRaidKaiju(kaiju).then((ok) => {
    if (ok && stillHere()) go(soloRaidMission(kaiju, difficulty));
  });
}
