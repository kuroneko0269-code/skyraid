// リプレイのファイル（7-B）: .skyreplay の書き出し（ダウンロード）と読み込み（ファイルの選択）
import { REPLAY_CONFIG } from '../data/replay';
import type { ReplayHeader } from '../replay/types';

/** ファイル名: skyraid-<モード>-<日付>.skyreplay（名前に使えない文字は _） */
export function replayFileName(header: ReplayHeader, name: string): string {
  const date = header.date.slice(0, 16).replace(/[:T]/g, '-');
  const base = `skyraid-${name || header.mode}-${date}`.replace(/[\\/:*?"<>|\s]+/g, '_');
  return `${base}${REPLAY_CONFIG.extension}`;
}

/** バイト列をファイルとして保存させる */
export function downloadReplay(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes.slice().buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/** ファイルを選ばせて読む（取り消し・読めなければ null） */
export function pickReplayFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${REPLAY_CONFIG.extension},application/octet-stream`;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .arrayBuffer()
        .then((buf) => {
          resolve({ name: file.name.replace(/\.[^.]+$/, ''), bytes: new Uint8Array(buf) });
        })
        .catch(() => {
          resolve(null);
        });
    });
    input.click();
  });
}
