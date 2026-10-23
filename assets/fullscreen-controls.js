let playing=false,muted=false;
const buttons=['play','mute','exit','hide'];
for(const id of buttons)document.getElementById(id).onclick=async()=>{const button=document.getElementById(id);button.disabled=true;try{await window.qixuControls.action(id==='play'?(playing?'pause':'play'):id);}finally{button.disabled=false;}};
window.qixuControls.subscribe(state=>{playing=!!state.playing;muted=!!state.muted;document.getElementById('play').textContent=playing?'暂停':'播放';document.getElementById('play').setAttribute('aria-label',playing?'暂停':'播放');document.getElementById('mute').textContent=muted?'取消静音':'静音';document.getElementById('mute').setAttribute('aria-label',muted?'取消静音':'静音');});
