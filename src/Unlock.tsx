import { useEffect,useRef,useState } from 'react';
import { ArrowRight,LockKeyhole,X } from 'lucide-react';
export default function Unlock(){
 const [password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{input.current?.focus();},[]);
 return <main className="unlock-shell"><header className="unlock-drag"><span>栖序</span><button aria-label="返回待办" onClick={()=>void window.moyu.cancelUnlock()}><X size={17}/></button></header><div className="unlock-card"><span className="unlock-symbol"><LockKeyhole size={25} strokeWidth={1.5}/></span><span className="unlock-eyebrow">QIXU · ACCESS</span><h1>访问验证</h1><p>输入口令，继续。</p><form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);try{await window.moyu.submitPassword(password);setPassword('');}catch{setError('暂时无法验证，请返回待办后重试。');}finally{setBusy(false);}}}><input ref={input} aria-label="访问口令" type="password" value={password} maxLength={64} autoComplete="off" spellCheck={false} onChange={e=>setPassword(e.target.value)} placeholder="输入访问口令"/><button aria-label="验证" disabled={busy||!password}><ArrowRight size={19}/></button></form>{error&&<span role="alert">{error}</span>}<button className="unlock-cancel" onClick={()=>void window.moyu.cancelUnlock()}>返回待办</button></div></main>;
}
