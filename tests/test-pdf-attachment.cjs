const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const calls=[],library={editable:true,filesEditable:true},parent={id:17,isRegularItem:()=>true,isEditable:()=>true};let fail=false,hold;
const ctx={PathUtils:{normalize:path.win32.normalize,filename:path.win32.basename},Zotero:{isWin:true,Libraries:{get:()=>library},Items:{get:()=>parent},Attachments:{importFromFile:async o=>{calls.push(o);if(hold)await hold;if(fail)throw Error('disk unavailable');return {id:101}}}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/pdf-export.js','utf8'),ctx);
const api=ctx.PaperPDFExport,source={id:5,libraryID:1,parentID:17,getCollections:()=>[7,8]},file='D:\\Papers\\中文-example.pdf';
async function main(){
 assert.equal(await api.registerPDF(source,file),101);assert.equal(calls[0].parentItemID,17);assert.equal(calls[0].libraryID,1);assert.equal(calls[0].contentType,'application/pdf');assert.equal(calls[0].title,'中文-example');assert.equal(calls[0].moveFile,undefined);assert.equal(calls[0].collections,undefined);
 await api.registerPDF({...source,parentID:false},file);assert.equal(calls[1].parentItemID,undefined);assert.deepEqual(Array.from(calls[1].collections),[7,8]);
 library.filesEditable=false;await assert.rejects(api.registerPDF(source,file),/不允许/);assert.equal(calls.length,2);library.filesEditable=true;
 parent.deleted=true;await assert.rejects(api.registerPDF(source,file),/已删除/);parent.deleted=false;
 await assert.rejects(api.registerPDF({...source,deleted:true},file),/回收站/);
 fail=true;await assert.rejects(api.registerPDF(source,file),/disk unavailable/);fail=false;assert.equal(await api.registerPDF(source,file),101,'retry after failed registration does not require translation');
 let release;hold=new Promise(r=>release=r);const before=calls.length,a=api.registerPDF(source,file),b=api.registerPDF(source,file);release();assert.deepEqual(await Promise.all([a,b]),[101,101]);assert.equal(calls.length,before+1,'concurrent registration is shared');
 console.log('PASS managed PDF attachment parent/library, standalone collection, read-only and deleted targets, retry, concurrent deduplication and retaining original export');
}
main().catch(e=>{console.error(e);process.exitCode=1});
