const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path').posix,crypto=require('crypto');
const script=fs.readFileSync('src/pdf-publication.js','utf8');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
 const files=new Map(),items=new Map(),faults={},log=[];let sequence=10,uuid=0;
 const put=(p,s)=>files.set(p,String(s));
 const bytes=p=>{if(!files.has(p))throw Error('missing: '+p);return files.get(p);};
 const fail=(op,...args)=>{if(faults[op])faults[op](...args);};
 const io={exists:async p=>files.has(p),makeDirectory:async()=>{},getChildren:async p=>[...files.keys()].filter(k=>path.dirname(k)===p),computeHexDigest:async p=>sha(bytes(p)),readUTF8:async p=>bytes(p),writeUTF8:async(p,s)=>{fail('write',p,s);put(p,s);},copy:async(a,b,o)=>{fail('copy',a,b);if(o?.noOverwrite&&files.has(b))throw Error('exists');put(b,bytes(a));},move:async(a,b,o)=>{fail('move',a,b);if(o?.noOverwrite&&files.has(b))throw Error('exists');put(b,bytes(a));files.delete(a);},remove:async p=>{fail('remove',p);files.delete(p);}};
 function pdf(title,p,body,{parentID=1,stored=true,key}={}){
  const id=++sequence;key=key||'KEY'+id;put(p,body);
  const item={id,key,libraryID:1,parentID,deleted:false,isPDFAttachment:()=>true,isEditable:()=>true,isStoredFileAttachment:()=>stored,getField:()=>title,getFilePathAsync:async()=>p,eraseTx:async()=>{fail('erase',item);items.delete(id);if(stored)files.delete(p);}};items.set(id,item);return item;
 }
 const original='/storage/ORIGINAL/Article.pdf',dest='/storage/ORIGINAL/中文-Article.pdf',output='/jobs/output/translated.pdf';
 const source=pdf('Article',original,'ENGLISH',{key:'ORIGINAL'});put(output,'NEW');
 items.set(1,{id:1,getAttachments:()=>[...items.values()].filter(i=>i.parentID===1).map(i=>i.id)});
 const ctx={Services:{uuid:{generateUUID:()=>String(++uuid)}},PathUtils:{normalize:path.normalize,parent:path.dirname,filename:path.basename,join:path.join,isAbsolute:path.isAbsolute},IOUtils:io,Zotero:{isWin:false,DataDirectory:{dir:'/data'},Items:{get:id=>items.get(id),getByLibraryAndKey:(lib,key)=>[...items.values()].find(i=>i.libraryID===lib&&i.key===key)},Attachments:{getStorageDirectoryByLibraryAndKey:(lib,key)=>({path:'/storage/'+key})},logError:e=>log.push(e.message)}};
 vm.createContext(ctx);vm.runInContext(script,ctx);
 const register=async(a,p)=>{fail('register',a,p);const key='KEY'+(sequence+1);return pdf(path.basename(p,'.pdf'),'/storage/'+key+'/file.pdf',bytes(p),{parentID:a.parentID,key}).id;};
 const options={attachment:source,output,destination:dest,automatic:true,sourceHash:sha('ENGLISH'),register};
 const publish=(extra={})=>ctx.PaperPDFPublication.publish({...options,...extra});
 const cleanTemps=()=>assert.ok(![...files.keys()].some(p=>p.includes('.pgpdf-')));
 const children=()=>[...items.values()].filter(i=>i.parentID===1&&i.id!==source.id);
 return {files,items,faults,log,put,bytes,pdf,source,original,dest,output,publish,register,options,api:ctx.PaperPDFPublication,cleanTemps,children};
}
async function main(){
 let count=0;const test=async(name,fn)=>{await fn();console.log('PASS '+name);count++;};
 await test('stable output and managed attachment, repeated export leaves exactly one version',async()=>{
  const f=fixture(),first=await f.publish();assert.equal(f.bytes(f.dest),'NEW');assert.equal(first.path,f.dest);assert.equal(f.children().length,1);f.put(f.output,'UPDATED');
  const second=await f.publish();assert.equal(f.children().length,1);assert.ok(!f.items.has(first.attachmentID));assert.equal(f.bytes(f.dest),'UPDATED');assert.equal(f.bytes(f.original),'ENGLISH');assert.equal(second.cleanupWarning,undefined);f.cleanTemps();
 });
 await test('legacy numbered copies removed; original, unrelated names, notes and other parents survive',async()=>{
  const f=fixture();f.put(f.dest,'OLD');f.put('/storage/ORIGINAL/中文-Article (2).pdf','OLD2');
  const a=f.pdf('中文-Article','/storage/OLD1/old.pdf','OLD'),b=f.pdf('中文-Article (2)','/storage/OLD2/old.pdf','OLD2'),c=f.pdf('中文-Other','/storage/OTHER/other.pdf','OTHER'),d=f.pdf('中文-Article','/storage/PARENT/other.pdf','PARENT',{parentID:2});
  f.items.set(90,{id:90,parentID:1,libraryID:1,isPDFAttachment:()=>false,getField:()=> '中文-Article'});
  const r=await f.publish();assert.equal(r.cleanupWarning,undefined);assert.ok(!f.items.has(a.id)&&!f.items.has(b.id));assert.ok(f.items.has(c.id)&&f.items.has(d.id)&&f.items.has(90));assert.ok(!f.files.has('/storage/OLD1/old.pdf')&&!f.files.has('/storage/OLD2/old.pdf')&&!f.files.has('/storage/ORIGINAL/中文-Article (2).pdf'));assert.equal(f.bytes(f.original),'ENGLISH');f.cleanTemps();
 });
 await test('linked old attachment at stable path is replaced without deleting new PDF',async()=>{
  const f=fixture(),old=f.pdf('中文-Article',f.dest,'OLD',{stored:false});const r=await f.publish();assert.equal(r.cleanupWarning,undefined);assert.ok(!f.items.has(old.id));assert.equal(f.bytes(f.dest),'NEW');f.cleanTemps();
 });
 await test('provenance replaces renamed older attachment',async()=>{
  const f=fixture(),r=await f.publish();f.items.get(r.attachmentID).getField=()=> 'User renamed translation';await f.publish();assert.ok(!f.items.has(r.attachmentID));assert.equal(f.children().length,1);
 });
 for(const prior of [false,true])await test('registration failure rolls back stable file (old exists: '+prior+')',async()=>{
  const f=fixture();let old;if(prior){old=f.pdf('中文-Article','/storage/OLD/file.pdf','OLD');f.put(f.dest,'OLD');}f.faults.register=()=>{throw Error('import denied');};await assert.rejects(f.publish(),/import denied/);assert.equal(f.files.has(f.dest),prior);if(prior){assert.equal(f.bytes(f.dest),'OLD');assert.ok(f.items.has(old.id));}assert.equal(f.bytes(f.output),'NEW');assert.equal(f.bytes(f.original),'ENGLISH');f.cleanTemps();
 });
 await test('registry failure erases only new managed attachment and restores old file',async()=>{
  const f=fixture(),old=f.pdf('中文-Article','/storage/OLD/file.pdf','OLD');f.put(f.dest,'OLD');f.faults.write=()=>{throw Error('registry denied');};await assert.rejects(f.publish(),/registry denied/);assert.equal(f.bytes(f.dest),'OLD');assert.deepEqual(f.children().map(i=>i.id),[old.id]);assert.equal(f.bytes(f.output),'NEW');f.cleanTemps();
 });
 for(const fault of ['copy','move'])await test(fault+' failure retains existing PDF and attachment',async()=>{
  const f=fixture(),old=f.pdf('中文-Article','/storage/OLD/file.pdf','OLD');f.put(f.dest,'OLD');f.faults[fault]=()=>{throw Error(fault+' denied');};await assert.rejects(f.publish(),new RegExp(fault+' denied'));assert.equal(f.bytes(f.dest),'OLD');assert.ok(f.items.has(old.id));f.cleanTemps();
 });
 await test('concurrent external file modification is never overwritten',async()=>{
  const f=fixture();f.put(f.dest,'OLD');f.faults.copy=()=>f.put(f.dest,'EXTERNAL');await assert.rejects(f.publish(),/正在被修改/);assert.equal(f.bytes(f.dest),'EXTERNAL');f.cleanTemps();
 });
 await test('cleanup failure reports warning and retry cleans without another translation',async()=>{
  const f=fixture(),old=f.pdf('中文-Article','/storage/OLD/file.pdf','OLD');f.faults.erase=i=>{if(i.id===old.id)throw Error('locked old attachment');};const r=await f.publish();assert.match(r.cleanupWarning,/locked/);assert.equal(f.bytes(f.dest),'NEW');assert.ok(f.items.has(old.id));delete f.faults.erase;await f.publish();assert.equal(f.children().length,1);assert.ok(!f.items.has(old.id)&&!f.items.has(r.attachmentID));f.cleanTemps();
 });
 await test('orphaned managed file is cleaned on retry after item deletion',async()=>{
  const f=fixture(),old=f.pdf('中文-Article','/storage/OLDKEY/file.pdf','OLD',{key:'OLDKEY'});old.eraseTx=async()=>{f.items.delete(old.id);};f.faults.remove=p=>{if(p==='/storage/OLDKEY/file.pdf')throw Error('file locked');};const r=await f.publish();assert.match(r.cleanupWarning,/locked/);delete f.faults.remove;await f.publish();assert.ok(!f.files.has('/storage/OLDKEY/file.pdf'));assert.equal(f.children().length,1);
 });
 await test('source mutation aborts before any publication',async()=>{const f=fixture();f.put(f.original,'CHANGED');f.put(f.dest,'OLD');await assert.rejects(f.publish(),/原 PDF 已改变/);assert.equal(f.bytes(f.dest),'OLD');assert.equal(f.children().length,0);});
 await test('shared source storage is guarded before deleting managed old item',async()=>{const f=fixture();f.pdf('中文-Article','/storage/ORIGINAL/old.pdf','OLD');await assert.rejects(f.publish(),/共用存储目录/);assert.equal(f.bytes(f.original),'ENGLISH');assert.equal(f.children().length,1);});
 await test('explicit destination does not overwrite existing files or delete old exports',async()=>{const f=fixture(),old=f.pdf('中文-Article','/storage/OLD/file.pdf','OLD');f.put(f.dest,'OLD');await assert.rejects(f.publish({automatic:false}),/已存在/);assert.equal(f.bytes(f.dest),'OLD');assert.ok(f.items.has(old.id));});
 await test('parallel publication of one source is rejected',async()=>{const f=fixture();let release,entered;const reached=new Promise(r=>entered=r),hold=new Promise(r=>release=r);const first=f.publish({register:async(...args)=>{entered();await hold;return f.register(...args);}});await reached;await assert.rejects(f.publish(),/正在保存/);release();await first;assert.equal(f.children().length,1);});
 await test('legacy suffix detection is narrow and preserves year/other title',async()=>{const f=fixture();for(const s of ['中文-Article','中文-Article.pdf','中文-Article (2)','中文-Article-2','中文-Article (99)'])assert.ok(f.api.family(s,'中文-Article.pdf'));for(const s of ['中文-Article (2020)','中文-Article-other','中文-Another','Article'])assert.ok(!f.api.family(s,'中文-Article.pdf'));});
 console.log('PASS '+count+' PDF publication and rollback scenarios');
}
main().catch(e=>{console.error(e);process.exitCode=1});
