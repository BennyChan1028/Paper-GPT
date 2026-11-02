const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../src'),ctx={};vm.createContext(ctx);
for(const f of ['paragraphs.js','pdf-export.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx);
const api=ctx.PaperPDFExport;
(async()=>{
 const existing=new Set();ctx.PathUtils={filename:path.win32.basename,parent:path.win32.dirname,join:path.win32.join};ctx.IOUtils={exists:async p=>existing.has(p)};
 const original='D:\\Zotero\\storage\\ABCD1234\\Article.PDF';
 assert.equal(await api.defaultDestination(original),'D:\\Zotero\\storage\\ABCD1234\\中文-Article.pdf');
 existing.add('D:\\Zotero\\storage\\ABCD1234\\中文-Article.pdf');assert.equal(await api.defaultDestination(original),'D:\\Zotero\\storage\\ABCD1234\\中文-Article (2).pdf');
 existing.add('D:\\Zotero\\storage\\ABCD1234\\中文-Article (2).pdf');assert.equal(await api.defaultDestination(original),'D:\\Zotero\\storage\\ABCD1234\\中文-Article (3).pdf');
 const chinese='D:\\Papers\\中文-研究.pdf';existing.add(chinese);assert.equal(await api.defaultDestination(chinese),'D:\\Papers\\中文-研究 (2).pdf');
 const long=await api.defaultDestination('D:\\Papers\\'+'😀'.repeat(150)+'.pdf');assert.ok(path.win32.basename(long).length<255);assert.ok(!/[\uD800-\uDBFF]\.pdf$/.test(long));
 const text=('Scientific text with <b12>formula</b12> and <b3> citation. 😀 ').repeat(180),calls=[];
 const pieces=api.split(text,700);assert.equal(pieces.join(''),text);
 for(const p of pieces){assert.ok(p.length<=700);assert.ok(!/[\uD800-\uDBFF]$/.test(p));assert.ok(!/<[^>]*$/.test(p));}
 const out=await api.translate({id:'abc',text},{budget:2000,check(){},progress(){},ask:async p=>{assert.ok(p.length<=2000);calls.push(p);const rows=JSON.parse(p.slice(p.lastIndexOf('\n')+1));return JSON.stringify({translations:rows.map(x=>({id:x.id,translation:'译文'+x.text}))});}});
 assert.ok(calls.length>1);assert.equal((out.match(/<b12>/g)||[]).length,180);
 await assert.rejects(api.translate({id:'one',text:'Text <b12>formula</b12>'},{budget:8000,check(){},progress(){},ask:async()=>JSON.stringify({translations:[{id:'one-0',translation:'缺失公式占位符'}]})}),/占位符/);
 let sent=0;await assert.rejects(api.translate({id:'one',text:'English text'},{budget:8000,check(){},progress(){},ask:async()=>{sent++;throw Error('unknown send outcome');}}),/unknown send outcome/);assert.equal(sent,1);
 await assert.rejects(api.translate({id:'one',text:'English text'},{budget:8000,check(){},progress(){},ask:async()=>'{"translations":['}),/返回格式不完整/);
 let stop=false;await assert.rejects(api.translate({id:'stop',text:'Long text. '.repeat(400)},{budget:2000,check(){if(stop)throw Error('cancelled');},progress(){},ask:async p=>{stop=true;const x=JSON.parse(p.slice(p.lastIndexOf('\n')+1))[0];return JSON.stringify({translations:[{id:x.id,translation:'译文'+x.text}]});}}),/cancelled/);
 assert.equal(api.diagnostics().activeProcesses,0);
 console.log('PASS automatic Chinese prefix, same directory, collision numbering, Unicode filenames; PDF input budgets, placeholders and cancellation');
})().catch(e=>{console.error(e);process.exitCode=1});
