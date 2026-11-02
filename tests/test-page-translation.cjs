const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const base='src/',prefs=new Map(),records=[],events=[],requests=[];let next=0,badReply=false,failWrite=false,afterSend=null,reads=[];
const ctx={console,Date,JSON,Map,Set,Promise};vm.createContext(ctx);
for(const name of ['sessions.js','paragraphs.js','long-text.js'])vm.runInContext(fs.readFileSync(base+name,'utf8'),ctx);
ctx.PaperSessions.configure('https://chatgpt.com/g/g-p-test-page/project');
const sessions=ctx.PaperSessions,P=ctx.PaperParagraphs,home=sessions.project,chat=home.replace('/project','/c/page-test');
const chars=(text,line=0)=>Array.from(text).map((c,i)=>({c,u:c,rect:[10+i*5,100-line*20,15+i*5,110-line*20],paragraphBreakAfter:i===text.length-1}));
const pages=[{chars:chars('The first page reports a controlled experiment with reproducible results.')},{chars:Array.from({length:7},(_,i)=>chars('Current page paragraph '+i+' reports carefully controlled experimental results.',i)).flat()},{chars:chars('The final page reports a separate controlled experiment and reliable conclusions.')}];
const pdf={numPages:3,getPageData:async({pageIndex})=>{reads.push(pageIndex);events.push('read:'+pageIndex);return pages[pageIndex];}};
const app={page:2,pdfDocument:pdf},view={_iframeWindow:{PDFViewerApplication:app}},reader={itemID:2,_internalReader:{_primaryView:view},setAnnotations:async()=>{},navigate:async()=>{throw Error('translation must not scroll')}};
const item={id:2,key:'PDF',libraryID:1,isPDFAttachment:()=>true,isEditable:()=>true,getAnnotations:()=>records,getDisplayTitle:()=> 'Test PDF'};
function annotation(page,text,ai=true){const a={id:++next,key:'A'+next,annotationType:'underline',annotationText:text,annotationComment:'Original comment',annotationPosition:JSON.stringify({pageIndex:page,rects:[[10,100,2000,110]]}),getTags:()=>ai?[{tag:P.tag}]:[],isEditable:()=>true,saveTx:async()=>{},erase:async()=>{records.splice(records.indexOf(a),1);}};records.push(a);return a;}
ctx.Services={io:{newURI:spec=>({spec})},scriptSecurityManager:{getSystemPrincipal:()=>({})}};ctx.Components={utils:{cloneInto:v=>v}};
const win={Zotero_Tabs:{selectedID:'pdf'},ZoteroPane:{getSelectedItems:()=>[item]}};
ctx.Zotero={Prefs:{get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v)},getMainWindow:()=>win,Reader:{getByTabID:()=>reader},Items:{get:()=>item,getByLibraryAndKey:(_,key)=>records.find(a=>a.key===key)},DataObjectUtilities:{generateKey:()=> 'K'+(++next)},Promise:{delay:ms=>ms>=15000?new Promise(()=>{}):Promise.resolve()},DB:{executeTransaction:async fn=>{const snapshot=records.slice();try{return await fn()}catch(e){records.splice(0,records.length,...snapshot);throw e}}},Annotations:{saveFromJSON:async(_,a)=>{if(failWrite)throw Error('database write failed');const row=annotation(a.position.pageIndex,a.text);row.key=a.key;row.annotationPosition=JSON.stringify(a.position);row.annotationComment=a.comment;events.push('write:'+a.position.pageIndex);return row;}}};
ctx.Zotero.Item=class{async loadPrimaryData(){}setTags(tags){this.tags=tags}async save(){return ctx.Zotero.Annotations.saveFromJSON(item,{key:this.key,text:this.annotationText,comment:this.annotationComment,position:JSON.parse(this.annotationPosition),tags:this.tags});}};
vm.runInContext(fs.readFileSync(base+'assistant.js','utf8'),ctx);const api=ctx.PaperWebAssistant,build=api.diagnostics; // build comes from source without starting UI
const version=fs.readFileSync(base+'assistant.js','utf8').match(/const WEB_BUILD='([^']+)'/)[1];
function panel(){const s={busy:false,lockControls:[],mode:{value:'ask'},scope:{value:'pageTranslation'},write:{value:'answer'},command:{value:'0'},question:{value:''},status:{textContent:''}};
 sessions.associate((k,v)=>prefs.set('extensions.paperWebAssistant.'+k,v),sessions.key(item),chat);
 s.browser={currentURI:{spec:'about:blank',host:'chatgpt.com'},loadURI:u=>s.browser.currentURI.spec=u.spec,browsingContext:{currentWindowGlobal:{getActor:()=>({sendQuery:async(name,data)=>{
  if(name==='PaperWeb:ProjectState')return {actorBuild:version,url:s.browser.currentURI.spec,access:'ok',loaded:true,ready:true};
  if(name==='PaperWeb:VerifyProjectConversation')return {actorBuild:version,project:home,pageURL:home,status:'found',url:chat,complete:true};
  if(name==='PaperWeb:RenameConversation')return {renamed:true};
  if(name==='PaperWeb:Draft'){s.prompt=data.text;return {filled:true};}
  if(name==='PaperWeb:Send'){events.push('send');requests.push(s.prompt);afterSend?.();return {sent:true,url:chat};}
  if(name==='PaperWeb:WaitForAnswer'){if(badReply)return {text:'malformed answer'};const batch=JSON.parse(s.prompt.split('\n').at(-1));return {text:JSON.stringify({translations:batch.map(p=>({id:p.id,translation:'中文译文：'+p.text}))})};}
  return {};
 }})}}};return s;
}
const pageCommand={name:'翻译本页',scope:'pageTranslation',text:'translate'},fullCommand={name:'全文翻译',scope:'fullTranslation',text:'translate'};
async function main(){
 const old=annotation(1,'Old translated text'),other=annotation(0,'Other page translation'),manual=annotation(1,'Manual annotation',false),s=panel();
 afterSend=()=>{app.page=3};const result=await api.run(s,{command:pageCommand});afterSend=null;
 assert.deepEqual(reads,[1]);assert(result.includes('第 2 页'));assert.equal(records.filter(a=>a.getTags().length&&JSON.parse(a.annotationPosition).pageIndex===1).length,7);assert(records.includes(manual)&&records.includes(other));assert(!records.includes(old));assert.equal(requests.length,1,'all seven short paragraphs share one page request');
 assert(events.indexOf('write:1')>events.lastIndexOf('send'),'page is collected before writing');assert(records.filter(a=>!['Original comment'].includes(a.annotationComment)).every(a=>JSON.parse(a.annotationPosition).pageIndex===1),'changing visible page mid-reply cannot change target');
 app.page=2;const currentIDs=records.map(a=>a.id);badReply=true;await assert.rejects(api.run(s,{command:pageCommand}));badReply=false;assert.deepEqual(records.map(a=>a.id),currentIDs,'failed response keeps old translations');
 failWrite=true;await assert.rejects(api.run(s,{command:pageCommand}),/database write failed/);failWrite=false;assert.deepEqual(records.map(a=>a.id),currentIDs,'database failure rolls deletion back');
 reads=[];requests.length=0;events.length=0;await api.run(s,{command:fullCommand});assert.deepEqual(reads,[0,1,2]);assert(requests.every(p=>!p.includes('Current page paragraph')),'full translation skips completed current page');assert(events.indexOf('write:0')<events.indexOf('read:1'),'full translation saves page before reading next');assert(records.includes(manual),'manual annotation survives full translation');
 const n=records.length;requests.length=0;await api.run(s,{command:fullCommand});assert.equal(requests.length,0);assert.equal(records.length,n,'second full run is idempotent');
 const page2=records.filter(a=>a.getTags().length&&JSON.parse(a.annotationPosition).pageIndex===1);await page2[0].erase();requests.length=0;await api.run(s,{command:fullCommand});assert.equal(records.length,n,'partial page fills only the missing paragraph');assert.equal(requests.length,1);assert(records.includes(manual));
 const empty=pages[1];pages[1]={chars:[]};app.page=2;const snapshot=records.map(a=>a.id);await assert.rejects(api.run(s,{command:pageCommand}),/OCR/);assert.deepEqual(records.map(a=>a.id),snapshot);pages[1]=empty;
 reader._internalReader._lastView={_iframeWindow:{PDFViewerApplication:{page:3,pdfDocument:pdf}}};reads=[];await api.run(s,{command:pageCommand});assert.deepEqual(reads,[2],'split-view active page is used');
 assert.equal(JSON.parse(fs.readFileSync(base+'commands.json')).find(c=>c.name==='翻译本页').scope,'pageTranslation');
 console.log('PASS current-page coordinates, frozen active page, bounded batches, atomic AI-only replacement, manual/other-page preservation, response/write failure rollback, full-document page order, completion/partial resume, OCR guard and active split view');
}
main().catch(e=>{console.error(e);process.exitCode=1});
