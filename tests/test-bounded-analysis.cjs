const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/long-text.js','utf8'),ctx);const L=ctx.PaperLongText;
async function main(){
 const content=Array.from({length:24},(_,i)=>'[第 '+(i+1)+' 页]\n'+('Sentence '+i+' has complete evidence and results. ').repeat(250)).join('\n\n');
 const parts=L.split(content);assert.equal(parts.map(p=>p.raw).join(''),content);assert(parts.length>20);assert(parts.every(p=>p.text.length<=6020));
 let sent=[];const render=t=>'根据材料形成大纲，只输出 JSON outline。\n'+t;
 const result=await L.execute({content,render,kind:'outline',ask:async p=>{sent.push(p);const pages=[...p.matchAll(/\[第 (\d+) 页\]/g)].map(m=>+m[1]);return JSON.stringify({outline:[...new Set(pages)].map(page=>({title:'Section '+page,page,summary:'中文证据总结'}))});}});
 const rows=JSON.parse(result).outline;assert.deepEqual(rows.map(p=>p.page),Array.from({length:24},(_,i)=>i+1));assert(sent.every(p=>p.length<=8000));
 await assert.rejects(L.execute({content,render,kind:'outline',ask:async()=>JSON.stringify({outline:[{title:'Wrong',page:999,summary:'错误'}]})}),/页码/);
 let mapCalls=0;sent=[];const summary=await L.execute({content,render:t=>'总结全部材料。\n'+t,ask:async p=>{sent.push(p);if(p.startsWith('为后续')){mapCalls++;return '本批保留研究事实与数字 42。';}return '完整汇总。';}});assert.equal(summary,'完整汇总。');assert(mapCalls>20);assert(sent.every(p=>p.length<=8000));
 sent=[];const translated=await L.execute({content,render:t=>'翻译材料。\n'+t,kind:'translation',ask:async p=>{sent.push(p);return '译文'+sent.length;}});assert(translated.includes('译文1'));assert.equal(translated.split('\n\n').length,sent.length);assert(!sent.some(p=>p.includes('事实笔记')));
 sent=[];await L.execute({content:content.slice(0,11000),render:t=>'总结材料。\n'+t,maxChars:2000,ask:async p=>{sent.push(p);return '中文总结。';}});assert(sent.every(p=>p.length<=2000),'declared input box limit overrides application budget');
 let cancelled=false,count=0;await assert.rejects(L.execute({content,render,check:()=>{if(cancelled)throw Error('stopped');},ask:async()=>{count++;cancelled=true;return '中文事实';}}),/stopped/);assert.equal(count,1);
 await assert.rejects(L.execute({content,render,ask:async()=>{throw Error('uncertain send');}}),/uncertain send/);
 let requests=0;await assert.rejects(L.execute({content,render:t=>'x'.repeat(8100)+t,ask:async()=>{requests++;return 'a';}}),/过长/);assert.equal(requests,0);
 const commands=JSON.parse(fs.readFileSync('src/commands.json'));assert.equal(commands.find(c=>c.name==='摘要总结').scope,'abstract');
 const A={JSON,Map,Set,Date};vm.createContext(A);vm.runInContext(fs.readFileSync('src/assistant.js','utf8'),A);
 A.PaperLibraryTools={prepareMaterials:async papers=>({materials:[{id:papers[0].id,text:'PDF 中的摘要内容',source:'pdf-abstract',coverage:'摘要'}],skipped:[],total:1}),materialNotice:()=>'',sourceLabel:()=> 'PDF 摘要'};
 const item={id:4,key:'PAPER',isRegularItem:()=>true,getDisplayTitle:()=> '论文',getField:k=>k==='title'?'论文':'',getTags:()=>[]};A.Zotero={getMainWindow:()=>({ZoteroPane:{getSelectedItems:()=>[item]}}),Reader:{getByTabID:()=>null}};
 const material=await A.PaperWebAssistant.context({},'abstract','',null);assert(material.includes('PDF 中的摘要内容'));assert(!material.includes('请先在 PDF'));
 console.log('PASS 280k-character source fully covered; outline page merge; bounded map/reduce; non-summary translation; actual declared input cap; cancellation/no uncertain resend; abstract without selection');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
