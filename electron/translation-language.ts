import { franc } from 'franc-min';
const languages:Record<string,string>={en:'eng_Latn',eng:'eng_Latn',zh:'zho_Hans',cmn:'zho_Hans',zho:'zho_Hans',ja:'jpn_Jpan',jpn:'jpn_Jpan',ko:'kor_Hang',kor:'kor_Hang',es:'spa_Latn',spa:'spa_Latn',fr:'fra_Latn',fra:'fra_Latn',de:'deu_Latn',deu:'deu_Latn',ru:'rus_Cyrl',rus:'rus_Cyrl',pt:'por_Latn',por:'por_Latn',it:'ita_Latn',ita:'ita_Latn',ar:'arb_Arab',arb:'arb_Arab',hi:'hin_Deva',hin:'hin_Deva',nl:'nld_Latn',nld:'nld_Latn',tr:'tur_Latn',tur:'tur_Latn',vi:'vie_Latn',vie:'vie_Latn',th:'tha_Thai',tha:'tha_Thai',id:'ind_Latn',ind:'ind_Latn',pl:'pol_Latn',pol:'pol_Latn',uk:'ukr_Cyrl',ukr:'ukr_Cyrl',fa:'pes_Arab',pes:'pes_Arab',he:'heb_Hebr',heb:'heb_Hebr',sv:'swe_Latn',swe:'swe_Latn',cs:'ces_Latn',ces:'ces_Latn',ro:'ron_Latn',ron:'ron_Latn',el:'ell_Grek',ell:'ell_Grek',bn:'ben_Beng',ben:'ben_Beng',ta:'tam_Taml',tam:'tam_Taml',hu:'hun_Latn',hun:'hun_Latn',fi:'fin_Latn',fin:'fin_Latn',da:'dan_Latn',dan:'dan_Latn',nb:'nob_Latn',no:'nob_Latn',nob:'nob_Latn',ms:'zsm_Latn',zsm:'zsm_Latn'};
export function detectLanguage(text:string,hint=''):string|null {
  if(/^[a-z]{3}_[A-Za-z]{4}$/.test(hint))return hint;
  const code=hint.toLowerCase().split(/[-_]/)[0];
  if(/[ぁ-ヿ]/.test(text))return 'jpn_Jpan';if(/[가-힣]/.test(text))return 'kor_Hang';
  if((text.match(/[\u4e00-\u9fff]/g)||[]).length>text.replace(/\s/g,'').length*.3)return 'zho_Hans';
  // A Chinese YouTube interface can contain English titles and descriptions.
  if(languages[code]&&!languages[code].startsWith('zho'))return languages[code];
  const detected=franc(text,{minLength:12});return languages[detected]||null;
}
export function splitTranslationText(text:string,limit=260):string[]{
  const sentences=text.match(/[^.!?。！？\n]+[.!?。！？]?/g)||[text];const out:string[]=[];
  for(const sentence of sentences){let rest=sentence.trim();while(rest.length>limit){let at=rest.lastIndexOf(' ',limit);if(at<limit/2)at=limit;out.push(rest.slice(0,at));rest=rest.slice(at).trim();}if(rest)out.push(rest);}return out;
}
