// 9-1 操作の診断の入口（scripts/analyze-replay.js が Vite のモジュールランナーで読み込む）。
// ファイルの読み書きは JS の側（@types/node を入れないため）。ここはバイト列を受け取り、文字列・バイト列を返す
import './i18n-setup';
import { encodeReplay } from '../../src/replay/codec';
import { analyzeBytes, type ReplayAnalysis } from './analyze';
import { findRole, flyMission, ROLES } from './flight';
import { formatTable, formatTimeline, type Group } from './report';
import { Totals } from './totals';

export interface InputFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface InputGroup {
  readonly label: string;
  readonly files: readonly InputFile[];
}

export interface AnalyzeOptions {
  readonly aspect: number;
  /** 1 本ずつの表も出す */
  readonly each: boolean;
  /** 推移を出す（1 本ずつ） */
  readonly timeline: boolean;
}

function describe(name: string, a: ReplayAnalysis): string {
  const notes = [`${name}: ${a.title}・v${a.gameVersion}・${a.totals.missionStatus || '-'}`];
  if (!a.startMatches)
    notes.push('（始めの状態が記録と違う: 判定の版の違いで結果がずれるかもしれない）');
  if (a.outcomeMatches === false) notes.push('（再生の結果が記録の結果と違う: 版の違いでずれた）');
  return notes.join('');
}

/** グループごとに集計して表にする。読めないファイルは理由を書いて飛ばす */
export function analyzeGroups(groups: readonly InputGroup[], o: AnalyzeOptions): string {
  const out: string[] = [];
  const merged: Group[] = [];
  const each: Group[] = [];
  for (const g of groups) {
    const total = new Totals();
    for (const f of g.files) {
      let a: ReplayAnalysis;
      try {
        a = analyzeBytes(f.bytes, { aspect: o.aspect });
      } catch (e) {
        out.push(`${f.name}: 読めない（${e instanceof Error ? e.message : String(e)}）`);
        continue;
      }
      out.push(describe(f.name, a));
      total.merge(a.totals);
      each.push({ label: f.name.replace(/\.skyreplay$/, ''), totals: a.totals });
      if (o.timeline) out.push(formatTimeline(a.totals), '');
    }
    if (total.files > 0) merged.push({ label: g.label, totals: total });
  }
  out.push('');
  if (o.each && each.length > 1) out.push(formatTable(each), '');
  if (merged.length > 0) out.push(formatTable(merged));
  return out.join('\n');
}

/** ボットのリプレイを作る（役 × ミッション × シード）。返す path は「役/ミッション-s シード.skyreplay」 */
export function makeBotReplays(
  missions: readonly string[],
  seeds: number,
  roles: readonly string[],
  progress: (line: string) => void,
): { path: string; bytes: Uint8Array }[] {
  const files: { path: string; bytes: Uint8Array }[] = [];
  for (const id of roles) {
    const role = findRole(id);
    for (const m of missions)
      for (let seed = 1; seed <= seeds; seed++) {
        const r = flyMission(m, seed, role, { record: true });
        if (!r.data) continue;
        const path = `${role.id}/${m}-s${seed}.skyreplay`;
        progress(`${path}: ${r.status}`);
        files.push({ path, bytes: encodeReplay(r.data) });
      }
  }
  return files;
}

export const ROLE_IDS = ROLES.map((r) => r.id);
export { runExperiments } from './experiments';
export { runDeviceFix } from './device-fix';
export { runAdvice } from './advice';
export { runTutorialMatrix } from './tutorial';
