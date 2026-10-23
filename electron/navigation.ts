export function isLoginPopup(url:string){
 if(url==='about:blank')return true;
 const parsed=new URL(url);
 return /(^|[./_-])(passport|login|signin|sign-in|oauth|authorize|captcha|verify|accounts)([./_-]|$)/i.test(parsed.hostname+parsed.pathname);
}
export function isVideoLink(url:string){const u=new URL(url);return /(^|\.)bilibili\.com$/.test(u.hostname)&&/^\/(video|bangumi\/play)\//.test(u.pathname)||/(^|\.)youtube\.com$/.test(u.hostname)&&/^\/(watch|shorts)(\/|$)/.test(u.pathname);}
