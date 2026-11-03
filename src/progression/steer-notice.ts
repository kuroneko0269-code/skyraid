// 「操作方法が新しくなりました」（9-2）を出すかどうか（DOM 非依存）: 今の利用者に一度だけ。初回起動の人（名前がまだ）は
// 新しい操作から始めるので出さない。出したら（出さないと決めたら）セーブの印 steerNotice を立てる
import type { SaveStore } from './save-store';

/** 起動のとき: 初回起動の人は出さない印を立てる */
export function markSteerNoticeForNewPilot(save: Pick<SaveStore, 'pilotName' | 'setFlag'>): void {
  if (save.pilotName === null) save.setFlag('steerNotice');
}

/** タッチ操作を出した飛行の始め: まだ出していなければ true（印を立てる） */
export function takeSteerNotice(save: Pick<SaveStore, 'flag' | 'setFlag'>): boolean {
  if (save.flag('steerNotice')) return false;
  save.setFlag('steerNotice');
  return true;
}
