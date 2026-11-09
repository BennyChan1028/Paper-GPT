const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
let stored=[],model,requests=[],next,hold=false,delayMs=0;
const prefs=new Map();
const win={crypto:require("node:crypto").webcrypto,TextEncoder,AbortController,setInterval,clearInterval,clearTimeout,setTimeout:(fn,ms)=>setTimeout(fn,delayMs||ms),fetch:async(url,options)=>{requests.push({url,options});if(hold)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('cancelled'))));if(typeof next==='function')return next(url,options);return next||{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"translations":[{"id":"p","translation":"中文译文"}]}'}}]})};}};
const ctx={Services:{logins:{findLogins:()=>stored,addLoginAsync:async l=>stored.push(l),modifyLogin:async(a,b)=>stored.splice(stored.indexOf(a),1,b),removeLogin:async l=>stored.splice(stored.indexOf(l),1)}},Components:{classes:{'@mozilla.org/login-manager/loginInfo;1':{createInstance:()=>({init:(origin,url,realm,username,password)=>{Object.assign(login,{origin,realm,username,password});}})}},interfaces:{nsILoginInfo:{}}},Zotero:{Prefs:{get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v)},getMainWindow:()=>win}};
let login;
ctx.Components.classes['@mozilla.org/login-manager/loginInfo;1'].createInstance=()=>{login={init(origin,url,realm,username,password){Object.assign(this,{origin,realm,username,password});}};return login;};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/translation-api.js','utf8'),ctx);const api=ctx.PaperTranslationAPI;
async function main(){
 await assert.rejects(api.client(),/保存 API Key/);assert.equal(requests.length,0);
 await assert.rejects(api.save({key:'invalid\nkey'}),/格式无效/);
 await api.save({key:'sk-fake-unit-secret',model:'deepseek-flash'});
 assert.equal(stored.length,1);assert.equal(stored[0].password,'sk-fake-unit-secret');assert.ok(!JSON.stringify([...prefs]).includes('secret'));
 assert.equal((await api.settings()).configured,true);assert.ok(!JSON.stringify(await api.settings()).includes('sk-'));
 await api.save({model:'deepseek-v4-pro'});assert.equal(stored[0].password,'sk-fake-unit-secret');
 const client=await api.client();const out=await client.ask('Return JSON {"translations":[]}');assert.ok(JSON.parse(out).translations);
 const {url,options}=requests.at(-1),body=JSON.parse(options.body);
 assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer sk-fake-unit-secret');assert.equal(body.model,'deepseek-v4-pro');assert.equal(body.thinking.type,'disabled');assert.equal(body.response_format.type,'json_object');assert.equal(body.max_tokens,8192);assert.ok(!options.body.includes('sk-fake'));
 await assert.rejects(client.ask('x'.repeat(8001)),/预算/);
 for(const status of [400,401,402,403,429,500]){next={ok:false,status,json:async()=>{throw Error('must not read error body containing secret')}};await assert.rejects(client.ask('JSON'),e=>e.message.includes(String(status))&&!e.message.includes('sk-fake'));}
 for(const choice of [{finish_reason:'length',message:{content:'{}'}},{finish_reason:'stop',message:{content:' '}},{finish_reason:'stop',message:{content:'incomplete'}},{finish_reason:'content_filter',message:{content:'{}'}}]){next={ok:true,json:async()=>({choices:[choice]})};await assert.rejects(client.ask('JSON'));}
 next={ok:true,json:async()=>{throw Error('raw body sk-fake-secret')}};await assert.rejects(client.ask('JSON'),e=>!e.message.includes('sk-fake'));
 next=undefined;hold=true;const pending=client.ask('JSON');setTimeout(()=>api.cancel(),10);await assert.rejects(pending,/已停止/);hold=false;
 hold=true;delayMs=10;await assert.rejects(client.ask('JSON'),/超时/);hold=false;delayMs=0;
 let cancelled=false;const guarded=await api.client({check:()=>{if(cancelled)throw Error('closed PDF')}});hold=true;const closed=guarded.ask('JSON');setTimeout(()=>cancelled=true,10);await assert.rejects(closed,/closed PDF/);hold=false;
 const reply=rows=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({translations:rows})}}]})});
 const prompt=rows=>'逐段翻译，只返回 JSON。\n'+JSON.stringify(rows);
 const rows=[{id:'0b4b408f773c124a5a334e17-0',text:'First paragraph <b1>formula</b1>.'},{id:'ed46d187bcac77314b18e9d6-0',text:'Second paragraph.'}];
 next=async(u,o)=>{const sent=JSON.parse(JSON.parse(o.body).messages[1].content.split('\n').at(-1));assert.deepEqual(sent.map(r=>r.id),['p1','p2']);return reply([{id:'p2',translation:'第二段'},{id:'p1',translation:'第一段 <b1>公式</b1>。'}]);};
 const mapped=JSON.parse(await client.ask(prompt(rows))).translations;assert.deepEqual(mapped.map(r=>r.id),rows.map(r=>r.id));assert.match(mapped[0].translation,/第一段/);assert.match(mapped[1].translation,/第二段/);
 let repairCalls=0;next=async(u,o)=>{repairCalls++;const sent=JSON.parse(JSON.parse(o.body).messages[1].content.split('\n').at(-1));if(repairCalls===1)return reply([{id:'p1',translation:''},{id:'p2',translation:'已完成第二段'}]);assert.deepEqual(sent.map(r=>r.id),['p1']);return reply([{id:'p1',translation:'补全第一段 <b1>公式</b1>。'}]);};
 const recovered=JSON.parse(await client.ask(prompt(rows))).translations;assert.equal(repairCalls,2);assert.equal(recovered[1].translation,'已完成第二段');assert.match(recovered[0].translation,/补全/);
 repairCalls=0;next=async()=>{repairCalls++;return repairCalls===1?reply([{id:'p1',translation:'改变了公式'},{id:'p2',translation:'第二段'}]):reply([{id:'p1',translation:'保留 <b1>公式</b1>'}]);};await client.ask(prompt(rows));assert.equal(repairCalls,2,'placeholder mismatch is repaired only for invalid rows');
 repairCalls=0;next=async()=>{repairCalls++;return reply([{id:'wrong',translation:'不可按返回顺序匹配'},{id:'p2',translation:'第二段'}]);};await assert.rejects(client.ask(prompt(rows)),/1 段.*已补取一次/);assert.equal(repairCalls,2);
 repairCalls=0;next=async()=>{repairCalls++;return repairCalls===1?reply([{id:'p1',translation:'第一段 <b1>x</b1>'},{id:'p1',translation:'冲突 <b1>x</b1>'},{id:'p2',translation:'第二段'}]):reply([{id:'p1',translation:'已确认 <b1>x</b1>'}]);};await client.ask(prompt(rows));assert.equal(repairCalls,2,'duplicate IDs never select an arbitrary translation');
 const large=[{id:rows[0].id,text:'English text. '.repeat(560)}];next=async(u,o)=>{const p=JSON.parse(o.body).messages[1].content;assert.ok(p.length<=8000);return reply([{id:'p1',translation:'完整长段落译文'}]);};assert.equal(JSON.parse(await client.ask(prompt(large))).translations[0].id,large[0].id);
 const beforeFormula=requests.length;next=async()=>{throw Error('formula must not request API')};const formula=JSON.parse(await client.ask(prompt([{id:'formula-id',text:'<b12> (1) </b12>'}])));assert.equal(formula.translations[0].translation,'<b12> (1) </b12>');assert.equal(requests.length,beforeFormula);
 next={ok:false,status:401};const beforeError=requests.length;await assert.rejects(client.ask(prompt(rows)),/401/);assert.equal(requests.length,beforeError+1,'HTTP errors never auto retry');
 next={ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'{}'}}]})};const beforeLength=requests.length;await assert.rejects(client.ask(prompt(rows)),/输出长度限制/);assert.equal(requests.length,beforeLength+1,'truncated replies never auto retry');
 await api.clear();assert.equal(stored.length,0);assert.equal((await api.settings()).configured,false);
 const noKeyCalls=requests.length;await assert.rejects(api.listModels(),/先保存/);assert.equal(requests.length,noKeyCalls);
 await api.save({key:'sk-fake-model-list-key',model:'deepseek-flash'});
 const modelRows=[{id:'deepseek-flash',name:'DeepSeek Flash',input_modalities:['text'],output_modalities:['text']},{id:'deepseek-v4-pro',name:'DeepSeek Pro'},{id:'deepseek-v4.2-pro',name:'Future text model'},{id:'deepseek-flash',name:'duplicate'},{id:'image-only',input_modalities:['image']},{id:'bad id'}];
 next={ok:true,json:async()=>({object:'list',data:modelRows})};const listed=await api.listModels();assert.equal(listed.length,3);
 const listing=requests.at(-1);assert.equal(listing.url,'https://api.deepseek.com/models');assert.equal(listing.options.method,'GET');assert.equal(listing.options.body,undefined);assert.equal(listing.options.credentials,'omit');assert.equal(listing.options.redirect,'error');assert.equal(listing.options.headers.Authorization,'Bearer sk-fake-model-list-key');
 assert.equal((await api.settings()).model,'deepseek-flash','fetching models must not change saved selection');assert.equal((await api.settings()).source,'api');
 await api.save({model:'deepseek-v4.2-pro'});const future=await api.client();assert.match(future.identity,/^deepseek-model-[a-f0-9]{64}$/);
 next={ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]})};await future.ask('Return JSON');assert.equal(JSON.parse(requests.at(-1).options.body).model,'deepseek-v4.2-pro','selected discovered ID reaches actual translation request');
 const restart={...ctx};vm.createContext(restart);vm.runInContext(fs.readFileSync('src/translation-api.js','utf8'),restart);assert.equal((await restart.PaperTranslationAPI.settings()).model,'deepseek-v4.2-pro');assert.equal((await restart.PaperTranslationAPI.settings()).models.length,3);
 const savedCatalog=JSON.stringify((await api.settings()).models);
 for(const response of [{ok:false,status:401},{ok:false,status:429},{ok:true,json:async()=>({data:[]})},{ok:true,json:async()=>({data:'invalid'})},{ok:true,json:async()=>{throw Error('raw private body')}}]){next=response;await assert.rejects(api.listModels(),e=>!e.message.includes('sk-fake')&&!e.message.includes('raw private'));assert.equal(JSON.stringify((await api.settings()).models),savedCatalog);assert.equal((await api.settings()).model,'deepseek-v4.2-pro');}
 next=undefined;hold=true;delayMs=10;await assert.rejects(api.listModels(),/超时/);hold=false;delayMs=0;assert.equal(JSON.stringify((await api.settings()).models),savedCatalog);
 hold=true;const pendingList=api.listModels();setTimeout(()=>api.cancel(),10);await assert.rejects(pendingList,/已停止/);hold=false;
 next=async()=>{await api.save({key:'sk-fake-replacement-model-key'});return {ok:true,json:async()=>({data:modelRows})};};await assert.rejects(api.listModels(),/API Key 已改变/);assert.equal((await api.settings()).source,'defaults','key rotation invalidates old account model cache');
 await assert.rejects(api.save({model:'not-listed-model'}),/获取模型列表/);
 await api.clear();assert.equal((await api.settings()).configured,false);assert.equal((await api.settings()).source,'defaults');
 console.log('PASS login-manager key save/update/clear, no pref secret, official endpoint/auth, model/JSON/non-thinking, input bounds, safe HTTP errors, truncation/empty/invalid replies, cancel/timeout/closed PDF short IDs restored after reordered replies, one targeted repair for empty/duplicate/invalid rows, formula-only preservation and no uncertain retries; model-list GET, filtering/cache, dynamic selection, restart persistence, selected request model, safe cache identity, failure preservation and key rotation');
}
main().catch(e=>{console.error(e);process.exitCode=1});
