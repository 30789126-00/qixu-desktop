import type { WindowState } from '../shared/types';

export type WindowMode = 'todo' | 'unlock' | 'privateVisible' | 'privateAutoHidden' | 'privatePanicHidden' | 'privateMinimized' | 'suspended';
export type WindowEvent = 'SHOW_TODO' | 'REQUEST_UNLOCK' | 'UNLOCK_OK' | 'AUTO_HIDE' | 'PANIC_HIDE' | 'MINIMIZE' | 'SUSPEND' | 'RESTORE';

const hiddenPrivate = new Set<WindowMode>(['privateAutoHidden','privatePanicHidden','privateMinimized','suspended']);

export function transitionWindowMode(current: WindowMode, event: WindowEvent): WindowMode {
  if (event === 'SHOW_TODO') return 'todo';
  if (event === 'REQUEST_UNLOCK') return current === 'privateVisible' || hiddenPrivate.has(current) ? current : 'unlock';
  if (event === 'UNLOCK_OK') return current === 'unlock' ? 'privateVisible' : current;
  if (event === 'AUTO_HIDE') return current === 'privateVisible' ? 'privateAutoHidden' : current;
  if (event === 'PANIC_HIDE') return current === 'privateVisible' || hiddenPrivate.has(current) ? 'privatePanicHidden' : current;
  if (event === 'MINIMIZE') return current === 'privateVisible' ? 'privateMinimized' : current;
  if (event === 'SUSPEND') return current === 'privateVisible' || hiddenPrivate.has(current) ? 'suspended' : current;
  if (event === 'RESTORE') return hiddenPrivate.has(current) ? 'privateVisible' : current;
  return current;
}

export function modeFields(mode: WindowMode): { access: 'todo'|'prompt'|'private'; windowState: WindowState } {
  if (mode === 'todo') return {access:'todo',windowState:'visible'};
  if (mode === 'unlock') return {access:'prompt',windowState:'visible'};
  if (mode === 'privateVisible') return {access:'private',windowState:'visible'};
  if (mode === 'privateAutoHidden') return {access:'private',windowState:'autoHidden'};
  if (mode === 'privatePanicHidden') return {access:'private',windowState:'panicHidden'};
  if (mode === 'privateMinimized') return {access:'private',windowState:'minimized'};
  return {access:'private',windowState:'suspended'};
}

export function modeFromFields(access:'todo'|'prompt'|'private', windowState:WindowState): WindowMode {
  if (access === 'todo') return 'todo';
  if (access === 'prompt') return 'unlock';
  if (windowState === 'autoHidden') return 'privateAutoHidden';
  if (windowState === 'panicHidden') return 'privatePanicHidden';
  if (windowState === 'minimized') return 'privateMinimized';
  if (windowState === 'suspended') return 'suspended';
  return 'privateVisible';
}
