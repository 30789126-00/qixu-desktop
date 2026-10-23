export const SITE_COOLDOWN_MS=10*60*1000;
export function sanitizeCooldowns(value:unknown,now=Date.now()):Record<string,number>{
 const result:Record<string,number>={};
 if(value&&typeof value==='object')for(const [id,until] of Object.entries(value)){
  if(/^[\w-]{1,60}$/.test(id)&&typeof until==='number'&&Number.isFinite(until)&&until>now)result[id]=Math.min(until,now+SITE_COOLDOWN_MS);
 }
 return result;
}
export function cooldownMessage(until:number,now=Date.now()){
 const remaining=Math.max(0,Math.ceil((until-now)/60000));
 return remaining>0?`抖音提示“访问太频繁”，已停止此页面及登录弹窗的请求。请约 ${remaining} 分钟后点击“重新加载”手动尝试。10 分钟是本 App 的重试间隔，原站限制可能持续更久；登录数据已保留。`:'抖音此前提示“访问太频繁”，已停止自动请求。可以点击“重新加载”手动尝试；如仍受限，请继续等待原站解除限制。';
}
