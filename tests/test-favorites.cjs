const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const prefs=new Map(),ctx={Zotero:{Prefs:{get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v)}}};vm.createContext(ctx);
const source=fs.readFileSync('src/assistant.js','utf8').replace(/\r\n/g,'\n').replace('return {\n    async start(rootURI)','return {\n __test:{favoriteNames,toggleFavorite,renameFavorite,init:list=>commands=list},\n    async start(rootURI)');
const commands=JSON.parse(fs.readFileSync('src/commands.json','utf8')),key='extensions.paperWebAssistant.favoriteCommands',panel={busy:false};
function restart(){vm.runInContext(source,ctx);ctx.PaperWebAssistant.__test.init(commands);return ctx.PaperWebAssistant.__test;}
let t=restart();const initial=Array.from(t.favoriteNames());assert.equal(initial.length,6);assert(initial.includes('全文翻译为 PDF'));
t.toggleFavorite(panel,'翻译');assert(!t.favoriteNames().includes('翻译'));t=restart();assert(!t.favoriteNames().includes('翻译'),'removal survives restart');
t.toggleFavorite(panel,'翻译');assert.equal(t.favoriteNames().at(-1),'翻译');
const before=prefs.get(key);t.toggleFavorite({busy:true},'翻译');assert.equal(prefs.get(key),before);
prefs.set(key,'[]');t=restart();assert.equal(t.favoriteNames().length,0,'empty preference is not reset to defaults');
prefs.set(key,'["翻译","missing","翻译",3]');assert.deepEqual(Array.from(t.favoriteNames()),['翻译']);
t.renameFavorite('翻译','我的翻译');commands.find(c=>c.name==='翻译').name='我的翻译';t=restart();assert.deepEqual(Array.from(t.favoriteNames()),['我的翻译']);
t.renameFavorite('我的翻译','再次改名');commands.find(c=>c.name==='我的翻译').name='再次改名';t=restart();assert.deepEqual(Array.from(t.favoriteNames()),['再次改名'],'successive prompt renames retain favorite');
prefs.set(key,'invalid json');assert(t.favoriteNames().includes('全文翻译为 PDF'));
console.log('PASS favorite defaults, add/remove, restart persistence, empty list, stale data, busy guard and repeated prompt rename');
