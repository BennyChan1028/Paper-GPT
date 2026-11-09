const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
let stored=[],model,requests=[],next,hold=false,delayMs=0;
const prefs=new Map();
const win={AbortController,setInterval,clearInterval,clearTimeout,setTimeout:(fn,ms)=>setTimeout(fn,delayMs||ms),fetch:async(url,options)=>{requests.push({url,options});if(hold)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('cancelled'))));return next||{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"translations":[{"id":"p","translation":"中文译文"}]}'}}]})};}};
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
 await api.clear();assert.equal(stored.length,0);assert.equal((await api.settings()).configured,false);
 console.log('PASS login-manager key save/update/clear, no pref secret, official endpoint/auth, model/JSON/non-thinking, input bounds, safe HTTP errors, truncation/empty/invalid replies, cancel/timeout/closed PDF and no automatic retries');
}
main().catch(e=>{console.error(e);process.exitCode=1});
