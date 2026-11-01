// Vite の環境変数の型（7-4: オンライン連携。どちらも無ければオフライン）
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
