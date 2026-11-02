const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const ctx={};vm.createContext(ctx);for(const f of ['paragraphs.js','pdf-export.js'])vm.runInContext(fs.readFileSync('src/'+f,'utf8'),ctx);
const api=ctx.PaperPDFExport,items=Array.from({length:8},(_,i)=>({id:'p'+i,text:('Paragraph '+i+' presents a reproducible scientific result. ').repeat(12)}));
const decode=p=>JSON.parse(p.split('\n').at(-1));
async function main(){
 let calls=0,budgetReads=0;const partial=[];
 const options={check(){},progress(){},budget:async()=>{budgetReads++;return 8000},onPartial:async rows=>partial.push(rows),ask:async p=>{calls++;assert(p.length<=8000);return JSON.stringify({translations:decode(p).reverse().map(x=>({id:x.id,translation:'译文'+x.text}))})}};
 const result=await api.translatePage({items,page:2},options);
 assert.equal(calls,1);assert.equal(budgetReads,1);assert.equal(result.webRequests,1);assert.equal(result.translations.length,8);assert.equal(partial.length,1);
 for(let i=0;i<8;i++)assert.equal(result.translations[i].translation,('译文'+items[i].text).trim());
 calls=0;await api.translatePage({items:[{id:'long',text:'Scientific material. '.repeat(220)}],page:1},options);assert.equal(calls,1,'normal long paragraph does not split at old 3000-character limit');
 calls=0;const dense={items,page:3};const batches=api.pageBatches(dense,1800).batches;assert(batches.length>1);
 const originals=new Map();for(const b of batches){assert(api.pagePrompt(b,3).length<=1800);for(const p of b)originals.set(p.parent,(originals.get(p.parent)||'')+p.text)}
 for(const item of items)assert.equal(originals.get(item.id),item.text);
 const saved=[];let sent=0;
 await assert.rejects(api.translatePage(dense,{...options,budget:1800,onPartial:async rows=>saved.push(rows),ask:async p=>{if(++sent===2)throw Error('uncertain outcome');return JSON.stringify({translations:decode(p).map(x=>({id:x.id,translation:'译文'+x.text}))})}}),/uncertain outcome/);
 assert.equal(sent,2);assert(saved.length>0&&saved[0].length<8,'completed original paragraphs are checkpointed before next request');
 let checkpoints=0;
 await assert.rejects(api.translatePage({items:[{id:'p',text:'A <b2>formula</b2> result.'}]},{...options,onPartial:async()=>checkpoints++,ask:async p=>JSON.stringify({translations:decode(p).map(x=>({id:x.id,translation:'Missing formula'}))})}),/占位符/);assert.equal(checkpoints,0);
 await assert.rejects(api.translatePage(dense,{...options,ask:async()=>'{"translations":[]}'}),/译文数量/);
 const huge={items:[{id:'huge',text:'Large paragraph. '.repeat(500)}]};let halfSaved=0;
 await assert.rejects(api.translatePage(huge,{...options,budget:1800,onPartial:async()=>halfSaved++,ask:async p=>{if(decode(p)[0].id!=='huge-0')throw Error('stop after first piece');return JSON.stringify({translations:decode(p).map(x=>({id:x.id,translation:'译文'+x.text}))})}}),/stop after/);assert.equal(halfSaved,0,'partial long paragraph is never cached as complete');
 console.log('PASS one-page batching, eight paragraphs per send, long paragraph retention, actual composer budget, lossless overflow splitting, reordered replies, placeholders, checkpoints and uncertain-send stop');
}
main().catch(e=>{console.error(e);process.exitCode=1});
