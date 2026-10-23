import { useState } from 'react';
import { Keyboard, X } from 'lucide-react';
import type { AppState } from '../shared/types';

export default function BossKey({state,initial=false}:{state:AppState;initial?:boolean}){
 const [shortcut,setShortcut]=useState(initial?'Ctrl+Alt':state.settings.shortcut);
 const [required,setRequired]=useState(state.bossKey.passwordRequired);
 const [current,setCurrent]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const form=<form className="boss-key-form" onSubmit={async e=>{
  e.preventDefault();if(busy)return;setError('');setMessage('');
  if(password!==confirm){setError('两次输入的新口令不一致');return;}
  setBusy(true);
  try{await window.moyu.updateBossKey({shortcut,passwordRequired:required,currentPassword:current,newPassword:password||undefined});setCurrent('');setPassword('');setConfirm('');setMessage('老板键已保存，下次切换即可生效。');}
  catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }}>
  <label>切换快捷键<input aria-label="切换快捷键" value={shortcut} onChange={e=>setShortcut(e.target.value)} placeholder="Ctrl+Alt 或 Ctrl+Alt+Q" spellCheck={false}/><small>收起与唤回使用同一组按键。改为其他组合后，原 Ctrl+Alt 停用。</small></label>
  <label className="boss-key-check"><input type="checkbox" checked={required} onChange={e=>setRequired(e.target.checked)}/>访问验证<small>{required?'每次从待办进入时验证口令':'直接进入；暂离后的唤回保留原进度'}</small></label>
  {!initial&&state.bossKey.passwordRequired&&<label>当前口令<input aria-label="当前口令" type="password" autoComplete="off" maxLength={64} value={current} onChange={e=>setCurrent(e.target.value)}/><small>更改口令或关闭验证时填写。</small></label>}
  {(required||!initial)&&<><label>{initial?'设置口令':'新口令'}<input aria-label="新口令" type="password" autoComplete="new-password" minLength={4} maxLength={64} required={initial&&required} value={password} onChange={e=>setPassword(e.target.value)}/><small>{initial?'4～64 个字符，区分大小写':'留空保留原口令；新口令区分大小写。'}</small></label><label>确认新口令<input aria-label="确认新口令" type="password" autoComplete="new-password" maxLength={64} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label></>}
  {error&&<p className="form-error" role="alert">{error}</p>}{message&&<p className="boss-key-success" role="status">{message}</p>}
  <button className="button primary" disabled={busy}>{busy?'保存中…':initial?'保存并开始':'保存老板键'}</button>
 </form>;
 if(!initial)return form;
 return <main className="unlock-shell boss-key-welcome"><header className="unlock-drag"><span>栖序 · 初次见面</span><button aria-label="稍后设置" onClick={()=>void window.moyu.cancelUnlock()}><X size={17}/></button></header><section className="boss-key-intro"><span className="unlock-symbol"><Keyboard size={26}/></span><h1>为片刻从容，留一条捷径。</h1><p>设置老板键，按自己的习惯切换。以后可在「设置 → 老板键」调整。</p>{form}</section></main>;
}
