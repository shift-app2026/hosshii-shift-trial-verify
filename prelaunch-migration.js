/* Protected legacy recovery. No automatic ownership, network, deletion or cloud save. */
(function(root){
  'use strict';
  const PURPOSE='hosshii-legacy-ownership-v1';
  const clone=value=>JSON.parse(JSON.stringify(value));
  function create(options){
    const {storage,crypto,namespace,sourceKeys,identity,canWrite,withLock,parseSource,validateState,liveState}=options;
    const indexKey=`hosshii_prelaunch_state_v2:${namespace}:legacy-transfer-v1`;
    const now=options.now||Date.now;
    let reviewed=null,preparedHere=null;
    function fail(code,message){const error=Error(message);error.code=code;throw error;}
    function current(){const who=identity();if(!who||!who.hash||!who.key)fail('IDENTITY','本人確認が必要です。');return who;}
    function same(who){const actual=current();if(actual.hash!==who.hash||actual.key!==who.key)fail('IDENTITY','LINEアカウントが変わったため引き継ぎを停止しました。');}
    function editable(who){same(who);if(!canWrite())fail('READ_ONLY','現在は安全に引き継ぎを保存できません。');}
    async function digest(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
    function snapshot(){return Object.fromEntries(sourceKeys.map(key=>[key,storage.getItem(key)]));}
    async function source(){const raw=snapshot();return {raw,digest:await digest(JSON.stringify(raw)),exists:(options.dataKeys||sourceKeys).some(key=>raw[key]!==null)};}
    function readJSON(key){const raw=storage.getItem(key);if(raw===null)return null;try{return JSON.parse(raw);}catch(_){fail('RECORD_INVALID','引き継ぎ記録を読み取れません。元データは消去しないでください。');}}
    function put(key,value){const raw=JSON.stringify(value);storage.setItem(key,raw);if(storage.getItem(key)!==raw)fail('WRITE_VERIFY','保存内容の照合に失敗しました。元データは保護されています。');}
    function hasData(state){return !!state&&(Object.keys(state.shifts||{}).length>0||state.config?.jobCount>0||['job1','job2','job3'].some(key=>{const j=state.config?.[key];return j&&(j.name||j.closeDay||j.payDay||j.payDraft||j.payHistory?.length||j.wageSlots?.length||j.presets?.length||['paid','transMonth','transDay','allowanceMonth','allowanceDay'].some(k=>Number(j[k])>0));})||state.monthlyGoal>0);}
    function withoutRevision(state){const value=clone(state);delete value.storageRevision;return value;}
    function canonical(value){
      if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
      if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
      return JSON.stringify(value);
    }
    function assertNoDraft(who){
      const raw=storage.getItem(who.key),stored=raw===null?null:readJSON(who.key),memory=liveState?.();
      if(memory && (hasData(memory)||hasData(stored)) && canonical(withoutRevision(memory))!==canonical(withoutRevision(stored||{})))fail('UNSAVED','編集中の内容があります。先に現在の入力を保全してください。');
    }
    function decode64(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))fail('REVIEW_INVALID','確認記録を検証できません。');const base=value.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(base.padEnd(Math.ceil(base.length/4)*4,'=')),c=>c.charCodeAt(0));}
    async function verify(receipt,who,sourceDigest,allowExpired=false){
      same(who);
      if(!receipt||JSON.stringify(receipt).length>12000||typeof receipt.payload!=='string'||receipt.payload.length>8000)fail('REVIEW_INVALID','確認記録を検証できません。');
      const jwk=options.reviewPublicKey();
      if(!jwk)fail('REVIEW_UNCONFIGURED','所有者確認の受付準備中です。旧データは引き続き保護しています。');
      let data,valid=false;
      try{
        const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
        valid=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,decode64(receipt.signature),new TextEncoder().encode(receipt.payload));
        data=JSON.parse(receipt.payload);
      }catch(_){fail('REVIEW_INVALID','確認記録を検証できません。');}
      same(who);
      const issued=Date.parse(data?.reviewedAt),expires=Date.parse(data?.expiresAt);
      if(!valid||data.purpose!==PURPOSE||data.decision!=='confirmed'||data.ownerHash!==who.hash||data.namespace!==namespace||data.sourceDigest!==sourceDigest||!data.reviewId||!data.evidenceRef||!data.reviewer||!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now()||expires<=issued||(!allowExpired&&expires<=now()))fail('REVIEW_INVALID','本人・対象データ・有効期限に対応する確認記録が必要です。');
      return data;
    }
    function recordFor(who){
      const record=readJSON(indexKey);
      if(record && (record.version!==1||!['preparing','copying','awaiting-verification','complete'].includes(record.status)||!(/^[a-f0-9]{64}$/.test(record.ownerHash))||!(/^[a-f0-9]{64}$/.test(record.sourceDigest))||typeof record.stageKey!=='string'||!record.stageKey.startsWith(who.key+':transfer:'))){
        if(record?.version===1&&record.ownerHash!==who.hash)return {otherOwner:true};
        fail('RECORD_INVALID','引き継ぎ記録を確認できません。元データは保護しています。');
      }
      if(record&&record.ownerHash!==who.hash)return {otherOwner:true};
      return record;
    }
    async function inspect(){
      const who=current(),src=await source();same(who);const record=recordFor(who);
      if(record?.otherOwner)return {status:'protected',legacyExists:src.exists};
      if(!record)return {status:src.exists?'protected':'none',legacyExists:src.exists,reviewConfigured:!!options.reviewPublicKey()};
      return {status:record.status==='complete'&&src.digest!==record.sourceDigest?'protected-updated':record.status,legacyExists:src.exists,canResume:record.status!=='complete',reviewConfigured:!!options.reviewPublicKey()};
    }
    async function review(receipt){
      const who=current(),src=await source();same(who);
      const record=recordFor(who);if(record?.otherOwner)fail('OWNER','このデータは現在の利用者への引き継ぎ対象ではありません。');
      if(!src.exists)fail('NO_SOURCE','引き継ぐ旧データはありません。');
      const proof=await verify(receipt,who,src.digest);
      const state=parseSource(src.raw);validateState(state);same(who);
      reviewed={who,source:src,receipt:clone(receipt),proof,state:clone(state)};
      return {status:'ownership-confirmed',jobs:['job1','job2','job3'].filter(k=>!!state.config?.[k]?.name).length,shiftDates:Object.keys(state.shifts).length,requiresConsent:true};
    }
    async function locked(task){return withLock(`hosshii-legacy-transfer:${namespace}`,task);}
    async function prepare(consent){
      if(consent!==true||!reviewed)fail('CONSENT','所有者確認後、コピー準備への同意が必要です。');
      const who=current();same(reviewed.who);editable(who);
      return locked(async()=>{
        editable(who);const src=await source();same(who);
        if(src.digest!==reviewed.source.digest)fail('SOURCE_CHANGED','以前の端末データが更新されています。所有者確認からやり直してください。');
        await verify(reviewed.receipt,who,src.digest);editable(who);
        const existing=recordFor(who);if(existing?.otherOwner)fail('OWNER','別の利用者への引き継ぎ記録があります。');
        if(existing&&existing.sourceDigest===src.digest)fail('RESUME','準備済みのコピーがあります。再開手順で確認してください。');
        const targetRaw=storage.getItem(who.key),target=targetRaw===null?null:readJSON(who.key);
        if(hasData(target))fail('TARGET_HAS_DATA','現在のデータも保護しています。上書きせず、個別の引き継ぎ確認が必要です。');
        assertNoDraft(who);
        const revision=target?.storageRevision||0;if(!Number.isSafeInteger(revision)||revision>=Number.MAX_SAFE_INTEGER)fail('REVISION','保存版番号を確認してください。');
        const id=await digest(JSON.stringify([namespace,who.hash,src.digest,reviewed.proof.reviewId]));editable(who);
        const stageKey=who.key+':transfer:'+id;
        const targetState={...clone(reviewed.state),storageRevision:revision+1};
        const prior=readJSON(stageKey+':plan');
        const stage={version:1,id,ownerHash:who.hash,sourceDigest:src.digest,sourceRaw:src.raw,receipt:reviewed.receipt,targetBaseRaw:targetRaw,targetRaw:JSON.stringify(targetState),preparedAt:prior?.preparedAt??now()};
        if(prior&&JSON.stringify(prior)!==JSON.stringify(stage))fail('STAGE_CHANGED','準備中のコピーを確認してください。元データは保護しています。');
        if(!prior)put(stageKey+':plan',stage);
        if(existing)put(indexKey+':history:'+existing.stageKey.split(':').pop(),existing);
        const record={version:1,ownerHash:who.hash,stageKey,status:'preparing',sourceDigest:src.digest};
        put(indexKey,record);preparedHere=id;
        put(indexKey,{...record,status:'copying'});
        put(stageKey,stage);
        const copy=readJSON(stageKey);if(JSON.stringify(copy)!==JSON.stringify(stage))fail('COPY_VERIFY','コピー内容が一致しません。');
        validateState(JSON.parse(copy.targetRaw));
        put(indexKey,{...record,status:'awaiting-verification'});
        return {status:'awaiting-verification',requiresReload:true};
      });
    }
    async function validateCopy(stage,record,who){
      if(!stage||stage.version!==1||stage.ownerHash!==who.hash||stage.sourceDigest!==record.sourceDigest)fail('STAGE_INVALID','準備済みコピーを確認できません。');
      const proof=await verify(stage.receipt,who,stage.sourceDigest,true);same(who);
      if(!Number.isFinite(stage.preparedAt)||stage.preparedAt<Date.parse(proof.reviewedAt)||stage.preparedAt>=Date.parse(proof.expiresAt))fail('STAGE_INVALID','コピー準備時の確認記録を照合できません。');
      const id=await digest(JSON.stringify([namespace,who.hash,stage.sourceDigest,proof.reviewId]));same(who);
      if(stage.id!==id||record.stageKey!==who.key+':transfer:'+id)fail('STAGE_INVALID','コピーの識別情報が一致しません。');
      if(await digest(JSON.stringify(stage.sourceRaw))!==stage.sourceDigest)fail('STAGE_INVALID','保護した元データが一致しません。');
      const parsed=parseSource(stage.sourceRaw);validateState(parsed);validateState(JSON.parse(stage.targetRaw));
      if(canonical(withoutRevision(parsed))!==canonical(withoutRevision(JSON.parse(stage.targetRaw))))fail('STAGE_INVALID','コピーの内容照合に失敗しました。');
      const src=await source();same(who);if(src.digest!==stage.sourceDigest)fail('SOURCE_CHANGED','以前の端末データが更新されています。コピーは保護しています。');
      return parsed;
    }
    async function resumeUnlocked(who){
      same(who);let record=recordFor(who);if(!record||record.otherOwner)fail('NO_STAGE','この利用者の準備済みコピーはありません。');
      const plan=readJSON(record.stageKey+':plan');
      const parsed=await validateCopy(plan,record,who);
      if(preparedHere===plan.id)fail('RELOAD_REQUIRED','再読み込みしてコピー内容を確認してください。');
      if(record.status==='preparing'||record.status==='copying'){
        editable(who);
        const actual=storage.getItem(who.key);
        if(actual!==plan.targetBaseRaw)fail('TARGET_CHANGED','現在の保存内容が更新されています。上書きせず停止しました。');
        assertNoDraft(who);
        const prior=readJSON(record.stageKey);
        if(prior&&JSON.stringify(prior)!==JSON.stringify(plan))fail('STAGE_INVALID','コピー途中の内容が一致しません。元データは保護しています。');
        put(indexKey,{...record,status:'copying'});
        if(!prior)put(record.stageKey,plan);
        if(JSON.stringify(readJSON(record.stageKey))!==JSON.stringify(plan))fail('COPY_VERIFY','コピー内容が一致しません。');
        record={...record,status:'awaiting-verification'};put(indexKey,record);
      }
      const copy=readJSON(record.stageKey);
      if(JSON.stringify(copy)!==JSON.stringify(plan))fail('STAGE_INVALID','コピーと保護用の準備記録が一致しません。');
      await validateCopy(copy,record,who);same(who);
      return {status:record.status,requiresConfirmation:record.status!=='complete',jobs:['job1','job2','job3'].filter(k=>!!parsed.config?.[k]?.name).length,shiftDates:Object.keys(parsed.shifts).length};
    }
    async function resume(){const who=current();return locked(()=>resumeUnlocked(who));}
    async function finalize(consent){
      if(consent!==true)fail('CONSENT','確認後の移行確定への同意が必要です。');
      const who=current();editable(who);
      return locked(async()=>{
        await resumeUnlocked(who);editable(who);
        const record=recordFor(who),stage=readJSON(record.stageKey);
        if(record.status==='complete')return {status:'complete',alreadyComplete:true,metadataWarnings:record.metadataWarnings||[]};
        const actual=storage.getItem(who.key);
        if(actual!==stage.targetBaseRaw&&actual!==stage.targetRaw)fail('TARGET_CHANGED','現在の保存内容が更新されています。双方のデータを保護し、上書きを停止しました。');
        assertNoDraft(who);
        // Single atomic state write. A failed completion marker can be retried.
        if(actual!==stage.targetRaw){storage.setItem(who.key,stage.targetRaw);if(storage.getItem(who.key)!==stage.targetRaw)fail('WRITE_VERIFY','移行先の保存確認ができません。再開手順で確認してください。');}
        editable(who);
        const metadataWarnings=[];
        for(const name of options.metadataKeys||[]){
          try{const value=stage.sourceRaw[name],key=who.key+':meta:'+name;if(value!==null&&value!==undefined&&storage.getItem(key)===null){storage.setItem(key,value);if(storage.getItem(key)!==value)throw Error('metadata mismatch');}}catch(_){metadataWarnings.push(name);}
        }
        put(indexKey,{...record,status:'complete',metadataWarnings});
        return {status:'complete',sourceRetained:true,metadataWarnings};
      });
    }
    return Object.freeze({inspect,review,prepare,resume,finalize});
  }
  const api=Object.freeze({create});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HosshiiLegacyMigration=api;
})(typeof window==='undefined'?globalThis:window);
