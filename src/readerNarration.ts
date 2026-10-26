export interface SpokenParagraph { text:string; position:string; }
export function splitSpeechText(value:string,limit=220):string[]{
 const text=value.replace(/\s+/g,' ').trim();if(!/[\p{L}\p{N}]/u.test(text))return [];
 const result:string[]=[];let rest=text;
 while(rest.length>limit){let end=-1;for(let i=Math.min(limit,rest.length-1);i>=Math.floor(limit/3);i--)if(/[。！？；.!?;，, ]/.test(rest[i])){end=i+1;break;}
  if(end<0)end=limit;if(end<rest.length&&/[\uD800-\uDBFF]/.test(rest[end-1]))end--;
  result.push(rest.slice(0,end).trim());rest=rest.slice(end).trim();
 }if(rest)result.push(rest);return result;
}
export function speechElements(document:Document):Element[]{
 const selector='p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption';
 const elements=Array.from(document.querySelectorAll(`body ${selector.split(',').join(',body ')}`))
  .filter(el=>!el.querySelector(selector)&&!el.closest('[hidden],script,style,nav')&&!!splitSpeechText(el.textContent||'').length);
 return elements.length?elements:Array.from(document.querySelectorAll('body')).filter(el=>!!splitSpeechText(el.textContent||'').length);
}
