import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { migrateLegacy } from './legacy-migration';
export class TodoHost {
  child: ChildProcess | null=null;
  server: net.Server|null=null;
  socket: net.Socket|null=null;
  ready=false;
  constructor(private onCommand:(command:string)=>void,private onExit:()=>void){}
  send(command:string){if(this.socket&&!this.socket.destroyed)this.socket.write(command.replace(/[\r\n]/g,' ')+'\n',()=>{});}
  async start(executable:string,dataDir:string,appExe:string,startup:boolean,background:boolean,testing:boolean,shortcutConfigured:boolean){
    const folder=path.join(dataDir,'todo');
    await fs.mkdir(folder,{recursive:true});
    if(!testing)await migrateLegacy(dataDir);
    const nonce=randomBytes(32).toString('hex');
    const pipeName='qixu-'+nonce;
    this.server=net.createServer();
    await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen('\\\\.\\pipe\\'+pipeName,()=>resolve());});
    let buffer='';
    await new Promise<void>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('待办工作区启动超时')),12000);
      this.server!.on('connection',socket=>{
      this.socket=socket;socket.setEncoding('utf8');socket.on('error',()=>{});
      socket.on('data',chunk=>{
        buffer+=chunk.toString('utf8');
        while(buffer.includes('\n')){const end=buffer.indexOf('\n'),line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);
          if(!this.ready){if(line==='HELLO:'+nonce){this.ready=true;clearTimeout(timeout);resolve();}}else this.onCommand(line);
        }
      });});
      this.child=spawn(executable,['--managed',...(background?['--background']:[])],{windowsHide:false,stdio:['ignore','ignore','pipe'],env:{...process.env,QIXU_TODO_DATA:folder,QIXU_BRIDGE_NONCE:nonce,QIXU_PIPE_NAME:pipeName,QIXU_APP_EXE:appExe,QIXU_STARTUP:startup?'1':'0',QIXU_TEST:testing?'1':'0',QIXU_BOSS_KEY_CONFIGURED:shortcutConfigured?'1':'0'}});
      this.child!.once('error',e=>{clearTimeout(timeout);reject(e);});
      this.child!.once('exit',()=>{clearTimeout(timeout);if(!this.ready)reject(new Error('待办工作区未能启动'));this.ready=false;this.onExit();});
      this.child!.stderr?.on('data',()=>{});
    });
  }
  async stop(){const child=this.child;if(child&&child.exitCode===null){this.send('EXIT');await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},2500);child.once('exit',()=>{clearTimeout(timer);resolve();});});}this.child=null;this.socket?.destroy();this.server?.close();}
}
