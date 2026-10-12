/* Local attachment-to-conversation mapping. No ChatGPT private API is used. */
var PaperSessions = (() => {
  let project='';
  const normalizeProject=value=>{
    const match=String(value||'').trim().match(/^https:\/\/chatgpt\.com\/g\/(g-p-[a-zA-Z0-9-]+)\/project\/?(?:[?#].*)?$/);
    return match?'https://chatgpt.com/g/'+match[1]+'/project':null;
  };
  const projectID=()=>project.split('/')[4];
  const preference=k=>'session.'+projectID()+'.'+k;
  function configure(value){const normalized=normalizeProject(value);if(!normalized)throw new Error('请粘贴 ChatGPT 项目主页链接，而不是某个聊天的链接。');project=normalized;return project;}
  function key(item){
    if(!item?.key)return null;
    return (item.isPDFAttachment?.()?'pdf.':'item.')+item.libraryID+'.'+item.key;
  }
  function chat(url){
    if(!project)return null;
    const match=String(url||'').match(/^https:\/\/chatgpt\.com(\/(?:g\/(g-p-[a-zA-Z0-9-]+)\/)?c\/[a-zA-Z0-9-]+)\/?(?:[?#].*)?$/);
    return match&&(!match[2]||match[2]===projectID()||match[2].startsWith(projectID()+'-'))?'https://chatgpt.com'+match[1]:null;
  }
  function read(get,k){
    if(!project||!k)return null;
    for(const pref of [preference(k),'session.'+k]){
      try{const r=JSON.parse(get(pref,''));if(r.project===project&&r.key===k&&chat(r.url))return r;}catch(_){}
    }
    return null;
  }
  function sameChat(a,b){const left=chat(a),right=chat(b);return !!left&&!!right&&left.split('/c/')[1]===right.split('/c/')[1];}
  function entry(url){
    if(!project)return false;
    const match=String(url||'').match(/^https:\/\/chatgpt\.com\/g\/([^/]+)(?:\/project)?\/?(?:[?#].*)?$/);
    return !!match&&(match[1]===projectID()||match[1].startsWith(projectID()+'-'));
  }
  function named(get,put,key,url,title){
    const record=read(get,key);if(!record||!sameChat(record.url,url))return false;
    record.namedTitle=title;put(preference(key),JSON.stringify(record));return record;
  }
  function remember(get,put,s,state){
    if(!s.sessionKey||!s.creating||!s.projectReady||read(get,s.sessionKey))return false;
    const url=chat(state.url);
    // Flat /c routes require evidence that this exact PDF submitted from the project.
    if(!url||state.submissionToken!==s.sessionToken||(state.project&&state.project!==project))return false;
    const record={project,key:s.sessionKey,url,title:s.sessionTitle||'',createdAt:new Date().toISOString()};
    put(preference(s.sessionKey),JSON.stringify(record));put('pending.'+projectID()+'.'+s.sessionKey,'');s.savedSession=record;s.creating=false;
    return true;
  }
  function pending(get,key){if(!project)return null;try{const p=JSON.parse(get('pending.'+projectID()+'.'+key,''));return p.key===key&&p.project===project?p:null;}catch(_){return null;}}
  function reserve(put,s){put('pending.'+projectID()+'.'+s.sessionKey,JSON.stringify({key:s.sessionKey,project,token:s.sessionToken,createdAt:new Date().toISOString()}));}
  function release(put,key){put('pending.'+projectID()+'.'+key,'');}
  function retire(get,put,key,url,reason){
    if(!['conversation-missing','conversation-unavailable'].includes(reason))return false;
    const current=read(get,key);if(!current||!sameChat(current.url,url))return false;
    const historyKey='retired.'+projectID()+'.'+key;let history=[];
    try{const value=JSON.parse(get(historyKey,'[]'));if(Array.isArray(value))history=value;}catch(_){}
    history.push({...current,retiredAt:new Date().toISOString(),reason});
    put(historyKey,JSON.stringify(history.slice(-10)));
    put(preference(key),'');
    // An old unscoped preference must not bring the retired address back.
    try{const legacy=JSON.parse(get('session.'+key,''));if(legacy.project===project&&legacy.key===key&&sameChat(legacy.url,url))put('session.'+key,'');}catch(_){}
    release(put,key);return true;
  }
  function associate(put,key,url){
    const normalized=chat(url);if(!key||!normalized)throw new Error('请输入此 PDF 在当前项目中的聊天链接（含 /c/）。');
    const record={project,key,url:normalized,createdAt:new Date().toISOString(),manuallyLinked:true};
    put(preference(key),JSON.stringify(record));release(put,key);return record;
  }
  return {get project(){return project;},get prefix(){return project.slice(0,-'/project'.length);},generalKey:'general.ai-summary',generalTitle:'AI 摘要',normalizeProject,configure,key,chat,sameChat,entry,named,read,remember,pending,reserve,release,retire,associate};
})();
