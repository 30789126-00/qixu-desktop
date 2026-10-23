import type { Book, ResumeState, Section, Source } from '../shared/types';

export const emptyResumeState:ResumeState={section:'video',activeSourceId:null,mediaUrl:'',mediaTime:0,mediaWasPlaying:false,activeBookId:null,recoveredAfterCrash:false};

export function sanitizeResumeState(input:unknown,sources:Source[],books:Book[]):ResumeState {
  const value=(input&&typeof input==='object'?input:{}) as Partial<ResumeState>;
  const section:Section=['video','library','settings'].includes(value.section as string)?value.section as Section:'video';
  const activeSourceId=typeof value.activeSourceId==='string'&&sources.some(source=>source.id===value.activeSourceId)?value.activeSourceId:null;
  const activeBookId=typeof value.activeBookId==='string'&&books.some(book=>book.id===value.activeBookId)?value.activeBookId:null;
  return {section,activeSourceId,mediaUrl:typeof value.mediaUrl==='string'&&/^https?:\/\//i.test(value.mediaUrl)?value.mediaUrl.slice(0,8192):'',mediaTime:typeof value.mediaTime==='number'&&Number.isFinite(value.mediaTime)?Math.max(0,Math.min(86400*7,value.mediaTime)):0,mediaWasPlaying:value.mediaWasPlaying===true,activeBookId,recoveredAfterCrash:value.recoveredAfterCrash===true};
}

export interface SessionCheckpoint { schema:1; cleanExit:boolean; updatedAt:number; resume:ResumeState; }
export function checkpoint(resume:ResumeState,cleanExit=false):SessionCheckpoint { return {schema:1,cleanExit,updatedAt:Date.now(),resume:{...resume,recoveredAfterCrash:false}}; }
