// ホーム画面から起動しているか（iOS の navigator.standalone または display-mode: standalone）。
// インストールの案内（app-shell.ts）とオンライン連携のログイン（online-settings.ts。7-4c）で使う
interface NavigatorStandalone {
  standalone?: boolean;
}

export function isStandaloneDisplay(): boolean {
  const nav: Navigator & NavigatorStandalone = navigator;
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}
