// オンライン連携（7-4）の入口: 環境変数（VITE_SUPABASE_URL・VITE_SUPABASE_ANON_KEY）があるときだけ、
// Supabase とオンライン連携の画面を動的 import で読み込む。無ければ何も読み込まず、UI も出さない（今までどおり全モードが動く）
import type { GameState } from '../core/game-state';
import { readOnlineEnv } from '../online/env';
import type { SaveStore } from '../progression/save-store';
import type { Screens } from './screens';

export interface OnlineLinkParts {
  readonly game: GameState;
  readonly screens: Screens;
  readonly save: SaveStore;
}

export function linkOnline(p: OnlineLinkParts): void {
  const env = readOnlineEnv(import.meta.env);
  if (!env) return;
  void import('./online-app')
    .then((m) => {
      m.startOnline(env, p);
    })
    .catch(() => {
      // 読み込めなくてもゲームは今までどおり（次の起動でまた試す）
    });
}
