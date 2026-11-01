// ビルド設定（vite.config.ts・scripts/vite-app-info.ts）が使う Node の fs の最小限の型（7-D）。
// @types/node を入れると src のタイマーなどの型まで Node のものになるため、使う関数だけを宣言する
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
}
