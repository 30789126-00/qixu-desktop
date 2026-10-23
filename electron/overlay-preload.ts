import {contextBridge,ipcRenderer} from 'electron';
contextBridge.exposeInMainWorld('qixuControls',{
 action:(action:string)=>ipcRenderer.invoke('qixu:controls',action),
 subscribe:(callback:(state:any)=>void)=>{ipcRenderer.on('qixu:controls-state',(_event,state)=>callback(state));ipcRenderer.send('qixu:controls-ready');}
});
