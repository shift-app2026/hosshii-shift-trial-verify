'use strict';
const cfg = Object.freeze({liffId:'2011929118-NJGUu69C', endpoint:'https://ssfjopzfzsuwcxwirggv.supabase.co/functions/v1/consent-verify-status'});
const el = id => document.getElementById(id);
let busy = false, initialized = false;
function ready() {
  return location.origin === 'https://shift-app2026.github.io'
    && ['/hosshii-shift-trial-verify/consent-check/','/hosshii-shift-trial-verify/consent-check/index.html'].includes(location.pathname);
}
async function limit(promise,ms,abort) {
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{abort?.();reject(Error('通信が停止しました。もう一度、本人確認からやり直してください。'));},ms);})]);}
  finally{clearTimeout(timer);}
}
function sync() {el('start').disabled=busy || !el('agree').checked || !el('age').checked;el('identify').disabled=busy;}
async function check(accept) {
  if(busy)return;
  busy=true;sync();el('result').textContent='';
  try {
    if(!ready())throw Error('隔離確認用のURLではありません。');
    if(accept && (!el('agree').checked || !el('age').checked))throw Error('同意内容を確認してください。');
    if(!initialized){el('stage').textContent='LIFFを初期化中…';await limit(liff.init({liffId:cfg.liffId}),15000);initialized=true;}
    if(!liff.isLoggedIn()){el('stage').textContent='LINEログインへ移動します。';liff.login({redirectUri:location.href});return;}
    const token=liff.getIDToken();if(!token)throw Error('LINE本人確認を完了できません。');
    const controller=new AbortController();el('stage').textContent=accept?'同意と無料期間を記録中…':'未同意の登録状況を確認中…';
    const data=await limit((async()=>{
      const response=await fetch(cfg.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({idToken:token,...(accept?{consentAccepted:true,termsVersion:'2026-11-20',privacyVersion:'2026-11-20'}:{})})});
      const body=await response.json();if(!response.ok)throw Error('確認が停止しました（HTTP '+response.status+'）。'+String(body.error||''));return body;
    })(),12000,()=>controller.abort());
    el('consent').hidden=data.consentRequired!==true;
    el('stage').textContent=data.consentRequired?'未同意です。まだ無料お試しは開始されていません。':'専用領域の登録結果を確認しました。';
    el('result').textContent=JSON.stringify({status:data.status,consentRequired:data.consentRequired,trialStartedAt:data.trialStartedAt,trialExpiresAt:data.trialExpiresAt},null,2);
  } catch(error){el('consent').hidden=true;el('stage').textContent=error.message;}
  finally{busy=false;sync();}
}
el('identify').addEventListener('click',()=>check(false));el('start').addEventListener('click',()=>check(true));
el('agree').addEventListener('change',sync);el('age').addEventListener('change',sync);
