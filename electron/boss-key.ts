import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { verifyPassword } from './auth';
const derive=promisify(scrypt);
export interface BossKeyConfig { configured:boolean; passwordRequired:boolean; legacyCtrlAlt:boolean; passwordRecord:{salt:string;hash:string}|null; }
export function loadBossKey(input:any,existingInstall:boolean):BossKeyConfig {
  if(input?.configured===false)return {configured:false,passwordRequired:true,legacyCtrlAlt:false,passwordRecord:null};
  if(!input||input.configured!==true)return {configured:existingInstall,passwordRequired:true,legacyCtrlAlt:existingInstall,passwordRecord:null};
  const record=input.passwordRecord;
  const passwordRecord=record&&/^[a-f0-9]{32}$/.test(record.salt)&&/^[a-f0-9]{128}$/.test(record.hash)?{salt:record.salt,hash:record.hash}:null;
  return {configured:true,passwordRequired:input.passwordRequired!==false,legacyCtrlAlt:input.legacyCtrlAlt===true,passwordRecord};
}
export function normalizeBossShortcut(value:unknown):string {
  if(typeof value!=='string'||value.length>80)throw Error('请输入有效的切换快捷键');
  const text=value.trim().replace(/\s+/g,'');
  if(/^(ctrl|control)\+alt$/i.test(text))return 'Ctrl+Alt';
  if(!/^(?:(?:Ctrl|Control|Alt|Shift|CommandOrControl)\+)+[A-Za-z0-9]+$/i.test(text))throw Error('请使用 Ctrl、Alt、Shift 加一个按键，例如 Ctrl+Alt+Q');
  return text;
}
export async function createPasswordRecord(password:unknown) {
  if(typeof password!=='string'||password.length<4||password.length>64||!password.trim())throw Error('新口令请输入 4～64 个字符');
  const salt=randomBytes(16).toString('hex');
  return {salt,hash:(await derive(password,salt,64) as Buffer).toString('hex')};
}
export async function verifyBossPassword(input:unknown,config:BossKeyConfig):Promise<boolean> {
  if(typeof input!=='string'||input.length>64)return false;
  if(!config.passwordRecord)return verifyPassword(input);
  const actual=await derive(input,config.passwordRecord.salt,64) as Buffer;
  return timingSafeEqual(actual,Buffer.from(config.passwordRecord.hash,'hex'));
}
