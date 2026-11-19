/* Per-account device storage and one editor per origin/account. No network or tokens stored. */
(function () {
  'use strict';
  const BASE = 'hosshii_prelaunch_state_v2';
  const namespace = window.HOSSHII_ISOLATED_CONFIG?.storageNamespace || 'hosshii-shift';
  const session = {subjectHash:null,subject:null,key:null,locked:false,reason:'pending',release:null,lockTask:null};
  let activation = null;
  window.hosshiiEntitlementReadOnly = true;
  window.hosshiiEntitlementStatusReason = 'checking';
  const messages = {
    pending:'端末の保存状態を確認しています。確認が終わるまで編集できません。',
    busy:'別の画面でこのアプリを編集中です。そちらを閉じてから「再確認」を押してください。この画面は閲覧できます。',
    conflict:'別の画面で保存内容が更新されています。入力内容はこの画面に保持しています。必要な入力を書き出してから「再確認」で保存済みデータを読み直してください。',
    unsupported:'このブラウザーでは安全な同時編集を制御できません。データは閲覧できます。最新版のChromeまたはLINEで開き直してください。',
    unavailable:'端末の保存領域を安全に利用できません。データを消去せず、通信・ブラウザーの設定を確認してください。',
    account:'LINEアカウントが変わったため画面を停止しました。未保存の入力がある場合は元のアカウントに戻して保存してください。別のアカウントで使う場合は再読み込みしてください。'
  };
  window.hosshiiStorageMessage = () => messages[session.reason] || messages.unavailable;
  function refresh() {
    window.hosshiiStorageReadOnly = !session.locked || session.reason !== 'ready';
    window.hosshiiReadOnly = window.hosshiiEntitlementReadOnly || window.hosshiiStorageReadOnly;
    window.hosshiiStatusReason = window.hosshiiEntitlementReadOnly
      ? window.hosshiiEntitlementStatusReason : window.hosshiiStorageReadOnly ? 'local-storage' : 'active';
    if (typeof window.hosshiiSyncExpiredUI === 'function') window.hosshiiSyncExpiredUI();
    if(document.readyState!=='loading')void renderRecoveryNotice();
  }
  window.hosshiiSetEntitlement = function (readOnly, reason) {
    window.hosshiiEntitlementReadOnly = !!readOnly;
    window.hosshiiEntitlementStatusReason = reason;
    refresh();
  };
  window.hosshiiStorageCanEdit = () => {
    if(session.subject && !window.hosshiiCheckStorageIdentity())return false;
    return session.locked && session.reason === 'ready';
  };
  window.hosshiiMarkStorageConflict = function () { session.reason = 'conflict'; refresh(); };
  function conceal(concealed) {
    const app = document.getElementById('appCard');
    if (!app) return;
    if (concealed) {
      app.style.setProperty('visibility','hidden','important');
      app.setAttribute('aria-hidden','true'); app.inert = true;
    } else {
      app.style.removeProperty('visibility');app.removeAttribute('aria-hidden');app.inert = false;
    }
  }
  function subjectFromVerifiedToken(token) {
    // This is called ONLY after the server accepted this same token. Decoding is
    // for local namespacing, not a substitute for server signature verification.
    if (!token) throw Error(messages.account);
    const parts = token.split('.');
    if (parts.length !== 3) throw Error('本人確認済みのLINE情報を読み取れません。LINEから開き直してください。');
    let payload;
    try {
      const b64 = parts[1].replace(/-/g,'+').replace(/_/g,'/');
      const bytes = Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length/4)*4,'=')),c=>c.charCodeAt(0));
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) { throw Error('本人確認済みのLINE情報を読み取れません。LINEから開き直してください。'); }
    if (payload.iss !== 'https://access.line.me' || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 200) {
      throw Error('LINEアカウントを識別できません。LINEから開き直してください。');
    }
    return payload.sub;
  }
  function accountChanged() {
    recoverySummary=null;++recoveryNoticeRun;session.reason='account';conceal(true);refresh();
    const gate=document.getElementById('lineAuthGate');if(gate)gate.hidden=false;
    const message=document.getElementById('lineAuthMessage');if(message)message.textContent=messages.account;
    const consent=document.getElementById('lineAuthConsent');if(consent)consent.hidden=true;
    const error=Error(messages.account);error.code='ACCOUNT_CHANGED';return error;
  }
  window.hosshiiCheckStorageIdentity = function() {
    if(!session.subject)return true;
    try {if(subjectFromVerifiedToken(window.liff?.getIDToken?.())===session.subject)return true;}catch(_){}
    accountChanged();return false;
  };
  window.hosshiiStorageMatchesToken = function(token) {
    try {
      if(session.subject && subjectFromVerifiedToken(token)===session.subject && window.hosshiiCheckStorageIdentity())return true;
    }catch(_){}
    accountChanged();return false;
  };
  async function subjectHash(sub) {
    if (!globalThis.crypto?.subtle) throw Error('安全な保存領域を初期化できません。HTTPSで開き直してください。');
    const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sub));
    return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function acquire(key) {
    if (session.locked && session.key === key) return true;
    if (!navigator.locks?.request) { session.reason = 'unsupported'; return false; }
    let decide;
    const ready = new Promise(resolve=>{decide=resolve;});
    const held = new Promise(resolve=>{session.release=resolve;});
    session.lockTask = navigator.locks.request(`hosshii-edit:${key}`,{mode:'exclusive',ifAvailable:true},async lock=>{
      if (!lock) { session.reason='busy';decide(false);return; }
      session.locked=true;decide(true);
      // Hold the Web Lock for the document lifetime. A second tab is read-only.
      await held;
      session.locked=false;
    }).catch(()=>{session.locked=false;session.reason='unavailable';decide(false);refresh();});
    return ready;
  }
  function emptyState() { return {schemaVersion:2,config:buildConfigData({jobCount:0}),shifts:{},monthlyGoal:0}; }
  const legacyDataKeys=[BASE,'mybasket_wages_v77','mybasket_wages_v76','mybasket_shifts_v23','mybasket_shifts_v22','mybasket_shifts_v21'];
  const legacySourceKeys=[...legacyDataKeys,'mybasket_last_backup','mybasket_backup_reminded','itoWallThreshold'];
  function parseProtectedSource(raw){
    let state;
    if(raw[BASE]!==null){
      state=JSON.parse(raw[BASE]);validatePrelaunchEnvelope(state);
      return {schemaVersion:2,config:buildConfigData(state.config),shifts:HosshiiPayModel.normalizeShifts(state.shifts,state.config),monthlyGoal:state.monthlyGoal};
    }
    const data={};for(const key of legacyDataKeys.filter(key=>key!==BASE))if(raw[key]!==null)data[key]=JSON.parse(raw[key]);
    const parsed=prelaunchParseBackup(data);
    return {schemaVersion:2,config:parsed.config,shifts:parsed.shifts,monthlyGoal:parsed.goal};
  }
  function recoveryIdentity(){
    if(!session.subjectHash||!session.key||!window.hosshiiCheckStorageIdentity())return null;
    return {hash:session.subjectHash,key:session.key};
  }
  const recovery=window.HosshiiLegacyMigration.create({
    storage:localStorage,crypto:globalThis.crypto,namespace,
    sourceKeys:legacySourceKeys,dataKeys:legacyDataKeys,
    metadataKeys:['mybasket_last_backup','mybasket_backup_reminded','itoWallThreshold'],
    identity:recoveryIdentity,
    canWrite:()=>window.hosshiiStorageCanEdit()&&!window.hosshiiEntitlementReadOnly,
    reviewPublicKey:()=>window.HOSSHII_ISOLATED_CONFIG?.legacyReviewPublicKey||null,
    withLock:(name,fn)=>navigator.locks.request(name,{mode:'exclusive',ifAvailable:true},lock=>{
      if(!lock)throw Error('別の画面で引き継ぎを確認しています。しばらくして再試行してください。');
      return fn();
    }),
    parseSource:parseProtectedSource,
    validateState:state=>{validatePrelaunchEnvelope(state);HosshiiPayModel.normalizeShifts(state.shifts,state.config);buildConfigData(state.config);},
    liveState:()=>prelaunchState()
  });
  let recoveryNoticeRun=0,recoverySummary=null;
  window.hosshiiLegacyRecovery=Object.freeze({
    inspect:()=>recovery.inspect(),
    review:receipt=>recovery.review(receipt),
    prepare:consent=>recovery.prepare(consent),
    resume:()=>recovery.resume(),
    finalize:async consent=>{const result=await recovery.finalize(consent);hydrate();refresh();return result;}
  });
  async function renderRecoveryNotice(){
    const run=++recoveryNoticeRun,tab=document.getElementById('tab-settings');
    if(!tab||!session.subjectHash)return;
    let info;
    try{info=await recovery.inspect();}catch(_){return;}
    if(run!==recoveryNoticeRun||!recoveryIdentity())return;
    let box=document.getElementById('hosshiiLegacyRecoveryNotice');
    if(info.status==='none'){if(box)box.hidden=true;return;}
    if(!box){box=document.createElement('section');box.id='hosshiiLegacyRecoveryNotice';box.setAttribute('role','status');box.style.cssText='margin:8px 0;padding:12px;border:1px solid #d9b8c4;border-radius:12px;background:#fffafc;color:#4c0519;font-size:14px;line-height:1.7;';tab.append(box);}
    box.hidden=false;box.replaceChildren();
    const message=document.createElement('p');box.append(message);
    function button(label,action){const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='margin:6px 6px 0 0;padding:10px;border:1px solid #d9b8c4;border-radius:9px;background:#fff;color:#781331;font:inherit;';b.addEventListener('click',action);box.append(b);return b;}
    function errorMessage(error){showAlertModal(error.message||'引き継ぎを確認できませんでした。元データは保護しています。');}
    if(info.status==='complete'){message.textContent='確認済みコピーへの引き継ぎは完了しています。元データも削除せず保持しています。';return;}
    if(['preparing','copying','awaiting-verification'].includes(info.status)){
      try{
        const summary=await recovery.resume();if(run!==recoveryNoticeRun)return;
        message.textContent=`保護用コピーを照合しました。勤務先${summary.jobs}件・シフト日${summary.shiftDates}件です。元データは残っています。`;
        const b=button('コピーを確認して移行を確定する',()=>{
          askConfirm('確認済みのコピーを、この利用者の保存先として確定します。元データは削除せず、クラウドにも自動保存しません。よろしいですか？',async()=>{
            b.disabled=true;
            try{const result=await window.hosshiiLegacyRecovery.finalize(true);showAlertModal('引き継ぎを確定しました。元データは削除していません。'+(result.metadataWarnings?.length?'\n一部の補助設定はコピーできませんでした。シフト・設定本体の保存は完了しています。':''));}
            catch(error){errorMessage(error);}finally{b.disabled=false;void renderRecoveryNotice();}
          });
        });b.disabled=window.hosshiiReadOnly===true;
      }catch(error){
        message.textContent=error.message;
        if(error.code==='RELOAD_REQUIRED')button('再読み込みしてコピーを確認する',()=>location.reload());
      }
      return;
    }
    message.textContent=info.reviewConfigured===false
      ?'以前の端末データを保護しています。引き継ぎ確認の受付は準備中です。元データを消去せず、管理者にご相談ください。現在の利用者へ自動で割り当てることはありません。'
      :'以前の端末データを保護しています。内容は現在の利用者へ割り当てていません。所有者確認済みの記録を受け取った場合は、ここから引き継ぎを確認できます。';
    const file=document.createElement('input');file.type='file';file.accept='.json,application/json';file.hidden=true;box.append(file);
    const load=button('確認済みの引き継ぎ記録を読み込む',()=>file.click());load.disabled=info.reviewConfigured===false||window.hosshiiReadOnly===true;
    file.addEventListener('change',async()=>{
      try{
        if(!file.files?.[0])return;
        if(file.files[0].size>12000)throw Error('確認記録の形式を確認してください。');
        recoverySummary=await recovery.review(JSON.parse(await file.files[0].text()));
        if(!recoveryIdentity())return;
        message.textContent=`所有者確認の記録を検証しました。勤務先${recoverySummary.jobs}件・シフト日${recoverySummary.shiftDates}件のコピーを準備できます。現在の保存先にデータがある場合は、上書きせず個別確認となります。`;
        button('同意して保護用コピーを準備する',()=>askConfirm('旧データのコピーを別の準備領域へ保存します。現在の内容は置き換えません。よろしいですか？',async()=>{
          try{await recovery.prepare(true);showAlertModal('保護用コピーを準備しました。再読み込み後に照合して確定してください。');}
          catch(error){errorMessage(error);}finally{void renderRecoveryNotice();}
        }));
      }catch(error){errorMessage(error);}
    });
  }
  function hydrate() {
    const state=prelaunchReadStored() || emptyState();
    if(storageWriteBlocked)throw Error('保存済みデータを読み取れません。データを消去せずご相談ください。');
    configData=buildConfigData(state.config);shiftsData=HosshiiPayModel.normalizeShifts(state.shifts,configData);monthlyGoal=state.monthlyGoal;
    settingsDraftDirty=false;updateSettingsSaveStatus(true);
    if(typeof restoreItoWallSelection==='function')restoreItoWallSelection();
    ensureValidSelectedJob();renderSettingsJobTabs();renderSettingsJobContent(currentSettingsJobKey);refreshAll();
  }
  window.hosshiiActivateVerifiedStorage = async function(token) {
    let sub;
    try {
      sub=subjectFromVerifiedToken(token);
      if(subjectFromVerifiedToken(window.liff?.getIDToken?.())!==sub)throw Error(messages.account);
    } catch(_) { throw accountChanged(); }
    const hash=await subjectHash(sub);
    try {if(subjectFromVerifiedToken(window.liff?.getIDToken?.())!==sub)throw Error(messages.account);}
    catch(_) {throw accountChanged();}
    if(session.subjectHash && hash!==session.subjectHash){
      throw accountChanged();
    }
    if(session.subjectHash===hash && session.locked && session.reason==='account'){session.reason='ready';conceal(false);refresh();return;}
    if(session.subjectHash===hash && (session.reason==='ready'||session.reason==='conflict')){conceal(false);refresh();return;}
    if(activation)return activation;
    activation=(async()=>{
      session.subjectHash=hash;session.subject=sub;
      session.key=`${BASE}:${namespace}:line:${hash}`;
      const writable=await acquire(session.key);
      if(!window.hosshiiCheckStorageIdentity())throw accountChanged();
      PRELAUNCH_STATE_KEY=session.key;
      if(!window.hosshiiCheckStorageIdentity())throw accountChanged();
      hydrate();
      if(writable)session.reason='ready';
      conceal(false);refresh();
    })();
    try { await activation; }
    catch(error){if(error.code==='ACCOUNT_CHANGED'){refresh();throw error;}session.reason='unavailable';refresh();if(['QuotaExceededError','SecurityError'].includes(error.name))throw Error('端末に保存できず、データの引き継ぎを完了できませんでした。旧データは削除していません。空き容量や保存設定を確認して再試行してください。');throw error;}
    finally {activation=null;}
  };
  window.hosshiiResolveStorageConflict = async function() {
    if(!session.subjectHash || !window.hosshiiCheckStorageIdentity())return;
    if(session.reason==='conflict' && !window.confirm('保存済みデータを読み直します。この画面の未保存の入力は読み直すと消えます。必要な入力を控えるか書き出した後で「OK」を押してください。'))return;
    try {
      const writable=session.locked || await acquire(session.key);
      if(!writable){refresh();return;}
      if(!window.hosshiiCheckStorageIdentity())return;
      hydrate();session.reason='ready';refresh();
    } catch(error){session.reason='unavailable';refresh();showAlertModal(error.message);}
  };
  window.addEventListener('storage',event=>{
    if(session.key && event.key===session.key && event.newValue!==prelaunchExpectedRaw){
      // Do not replace this page's input or memory with a newer snapshot.
      session.reason=session.locked?'conflict':'busy';refresh();
    }
  });
  document.addEventListener('DOMContentLoaded',()=>{void renderRecoveryNotice();},{once:true});
  refresh();
})();
