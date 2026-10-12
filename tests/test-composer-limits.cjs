const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const ctx={JSWindowActorChild:class{},JSON};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/WebChild.sys.mjs','utf8').replace('export class PaperWebChild','class PaperWebChild')+'\nthis.Actor=PaperWebChild',ctx);
async function main(){
 const a=new ctx.Actor(),input={id:'prompt-textarea',localName:'textarea',value:'',maxLength:12,getBoundingClientRect:()=>({width:100,height:30}),getAttribute:()=>null,closest:()=>null,focus:()=>{},dispatchEvent:()=>{}};
 class TextArea{};Object.defineProperty(TextArea.prototype,'value',{set(v){input.value=v;}});
 a.contentWindow={location:{hostname:'chatgpt.com'},getComputedStyle:()=>({visibility:'visible'}),HTMLTextAreaElement:TextArea,Event:class{}};
 a.document={querySelectorAll:()=>[input]};a.pageAccess=()=>({access:'ok'});
 const limits=await a.receiveMessage({name:'PaperWeb:InputLimits',data:{}});assert.equal(limits.maxLength,12);
 await assert.rejects(a.receiveMessage({name:'PaperWeb:Draft',data:{text:'x'.repeat(13)}}),/最多接受 12/);assert.equal(input.value,'');
 assert.equal((await a.receiveMessage({name:'PaperWeb:Draft',data:{text:'hello'}})).characters,5);
 input.value='';input.maxLength=-1;assert.equal((await a.receiveMessage({name:'PaperWeb:InputLimits',data:{}})).maxLength,null);
 input.localName='div';input.textContent='';input.innerText='';a.contentWindow.getSelection=()=>({removeAllRanges(){},addRange(){}});a.document.createRange=()=>({selectNodeContents(){}});a.document.execCommand=()=>{input.innerText='only part';return true;};
 await assert.rejects(a.receiveMessage({name:'PaperWeb:Draft',data:{text:'complete input'}}),/未完整接收/);
 console.log('PASS composer declared character maximum, no invented limit when absent, complete input verification and known-unsent truncation blocking');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
