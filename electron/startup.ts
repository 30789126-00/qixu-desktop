import type { App } from 'electron';
export const STARTUP_NAME='com.moyu.desktop';
export const STARTUP_ARGS=['--autostart'];
export function readStartup(app:Pick<App,'getLoginItemSettings'>,executable:string){
 const raw=app.getLoginItemSettings({path:executable,args:STARTUP_ARGS});
 const item=raw.launchItems?.find(entry=>entry.name===STARTUP_NAME&&entry.scope==='user');
 return {registered:!!item,enabled:raw.openAtLogin&&raw.executableWillLaunchAtLogin&&item?.enabled!==false};
}
export function writeStartup(app:Pick<App,'getLoginItemSettings'|'setLoginItemSettings'>,executable:string,enabled:boolean){
 app.setLoginItemSettings({name:STARTUP_NAME,path:executable,args:STARTUP_ARGS,openAtLogin:enabled,enabled});
 const actual=readStartup(app,executable);
 if(actual.enabled!==enabled||(enabled&&!actual.registered))throw new Error('Windows 未确认自启动设置，请检查系统启动应用状态后重试');
 return actual.enabled;
}
export function reconcileStartup(app:Pick<App,'getLoginItemSettings'|'setLoginItemSettings'>,executable:string,saved:boolean){
 const actual=readStartup(app,executable);
 // Repair a missing registration after an upgrade. Preserve an existing OS-disabled item.
 return saved&&!actual.registered?writeStartup(app,executable,true):actual.enabled;
}
