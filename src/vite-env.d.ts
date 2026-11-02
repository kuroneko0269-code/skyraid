// Vite の環境変数の型（7-4: オンライン連携。どちらも無ければオフライン）
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

// 7-D: ビルド時に作る版とライセンスの一覧（scripts/vite-app-info.ts）。8-1 で BGM の有無も
declare module 'virtual:app-info' {
  export const APP_VERSION: string;
  export const LICENSES: readonly {
    readonly name: string;
    readonly version: string;
    readonly license: string;
    readonly url: string;
    readonly text: string;
  }[];
  /** public/audio/bgm/ にあるファイル（'audio/bgm/title.mp3' の形。8-1） */
  export const BGM_FILES: readonly string[];
}
