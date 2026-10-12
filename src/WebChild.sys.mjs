const PAPER_WEB_ACTOR_BUILD='20261012-share-r11';
export class PaperWebChild extends JSWindowActorChild {
  async verifyProjectConversation(data){
    const doc=this.document,win=this.contentWindow,home=data.project;
    const id=url=>{
      try{const u=new URL(url,win.location.href);return u.origin==='https://chatgpt.com'&&(u.pathname.startsWith('/c/')||this.projectRoute(u.href,home))?u.pathname.match(/\/c\/([a-zA-Z0-9-]+)\/?$/)?.[1]:null;}catch(_){return null;}
    };
    const wanted=id(data.url),title=String(data.title||'').trim(),seen=new Map();
    const response=(status,extra={})=>({actorBuild:PAPER_WEB_ACTOR_BUILD,project:home,pageURL:win.location.href,status,...extra});
    const visible=e=>!!e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&win.getComputedStyle(e).visibility!=='hidden';
    const text=e=>(e.getAttribute('aria-label')||e.innerText||e.textContent||'').trim().replace(/\s+/g,' ');
    let quiet=0,foundTicks=0,previous='',reset=false,main;
    this.cancelled=false;
    for(let n=0;n<180;n++){
      if(this.cancelled)return response('unknown',{error:'任务已停止。'});
      if(!this.projectRoute(win.location.href,home,true))return response('unknown',{error:'尚未打开目标项目，不能核实对话。'});
      const access=this.pageAccess().access;
      if(!['ok','loading'].includes(access))return response('unknown',{error:access==='login-required'?'请先登录能访问该项目的账号。':'项目无法访问，不能判定对话是否存在。'});
      main=doc.querySelector('main');
      if(!main||!visible(main)||access==='loading'){quiet=0;await new Promise(r=>win.setTimeout(r,200));continue;}
      // Only the project's main list proves membership. Global/sidebar history
      // may still contain a deleted link, so it must never satisfy this check.
      const excluded=e=>!!e.closest('nav,aside,[data-testid*="sidebar"],#history,article,[data-message-author-role],form,[role="dialog"]');
      const links=[...main.querySelectorAll('a[href]')].filter(e=>!excluded(e)&&id(e.href)&&visible(e));
      for(const link of links){
        // Project rows contain both the title and a last-message preview. The
        // preview must not become part of the conversation name.
        const chatID=id(link.href),label=(link.querySelector('h1,h2,h3,[role="heading"]')?.textContent||link.getAttribute('aria-label')||link.getAttribute('title')||(link.innerText||link.textContent||'').trim().split(/\r?\n/)[0]).trim().replace(/\s+/g,' ');
        seen.set(chatID,{url:link.href,title:label});
      }
      const searches=[...main.querySelectorAll('input')].filter(e=>!e.closest('nav,aside,[data-testid*="sidebar"],#history,article,[data-message-author-role],[role="dialog"]')&&visible(e)&&/search (?:chats|conversations)|搜索(?:聊天|对话)/i.test([e.getAttribute('placeholder'),e.getAttribute('aria-label')].join(' ')));
      const headings=[...main.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(e=>!excluded(e)&&visible(e)&&/^(?:chats|conversations|聊天|对话|项目聊天|项目对话)(?:\s*[（(]?\d+[）)]?)?$/i.test(text(e)));
      const empty=[...main.querySelectorAll('p,[role="status"],h2,h3,div,span')].some(e=>!excluded(e)&&visible(e)&&/^(?:no (?:chats|conversations)(?: yet)?|you (?:don't|do not) have any chats(?: yet)?|(?:此|这个|该)?项目(?:中)?(?:还)?(?:没有|暂无)(?:聊天|对话)(?:。)?|暂无(?:聊天|对话))$/i.test(text(e)));
      const chatTab=[...main.querySelectorAll('[role="tab"]')].find(e=>!excluded(e)&&visible(e)&&/^(?:chats|conversations|聊天|对话)$/i.test(text(e)));
      if(chatTab&&chatTab.getAttribute('aria-selected')!=='true')return response('unknown',{error:'请先打开项目的“聊天”标签页，再核实对话。'});
      const recognized=searches.length>0||headings.length>0||empty||!!chatTab;
      if(searches.some(e=>e.value?.trim()))return response('unknown',{error:'项目对话列表正在被搜索条件筛选，请清空搜索条件后重试。'});
      const loading=[...main.querySelectorAll('[aria-busy="true"],[role="progressbar"],[data-testid*="loading"],[data-testid*="skeleton"]')].some(e=>!excluded(e)&&visible(e));
      const candidate=wanted&&links.find(e=>id(e.href)===wanted);
      if(candidate){
        // Do not trust a cached row while the project is still refreshing.
        // Keep this viewport until membership is stable and loading has ended.
        foundTicks=!loading&&doc.readyState==='complete'?foundTicks+1:0;
        if(foundTicks>=12)return response('found',{...seen.get(wanted),complete:false});
        await new Promise(r=>win.setTimeout(r,200));continue;
      }
      foundTicks=0;
      const more=[...main.querySelectorAll('button,[role="button"]')].find(e=>!excluded(e)&&visible(e)&&/^(?:show more|load more|see more|show all chats|see all chats|加载更多|显示更多|查看更多|更多聊天|查看全部聊天)(?:\s*(?:chats|conversations|聊天|对话))?$/i.test(text(e)));
      if(more){quiet=0;if(!more.disabled&&more.getAttribute('aria-disabled')!=='true')more.click();await new Promise(r=>win.setTimeout(r,250));continue;}
      // Traverse each list scroll container from the top, retaining IDs across
      // virtualized rows and triggering the site's ordinary lazy pagination.
      const containers=new Set();
      for(const anchor of [...links,...headings,...searches])for(let p=anchor.parentElement;p&&p!==doc.body;p=p.parentElement){
        const overflow=win.getComputedStyle(p).overflowY;
        if(!excluded(p)&&/(?:auto|scroll)/.test(overflow)&&p.scrollHeight>p.clientHeight+8)containers.add(p);
      }
      if(recognized&&doc.scrollingElement&&doc.scrollingElement.scrollHeight>doc.scrollingElement.clientHeight+8)containers.add(doc.scrollingElement);
      if(!reset&&containers.size){for(const c of containers)c.scrollTop=0;seen.clear();reset=true;quiet=0;await new Promise(r=>win.setTimeout(r,200));continue;}
      let moved=false;
      for(const c of containers)if(c.scrollTop+c.clientHeight<c.scrollHeight-4){c.scrollTop=Math.min(c.scrollHeight,c.scrollTop+Math.max(100,c.clientHeight-30));moved=true;}
      const fingerprint=JSON.stringify([[...seen.entries()],main.textContent?.length,[...containers].map(c=>[c.scrollTop,c.scrollHeight,c.clientHeight])]);
      quiet=recognized&&(seen.size>0||empty)&&!loading&&!moved&&doc.readyState==='complete'&&fingerprint===previous?quiet+1:0;previous=fingerprint;
      if(quiet>=12){
        const matches=[...seen.values()].filter(row=>row.title===title);
        if(matches.length>1)return response('unknown',{error:'项目中有多个同名对话，无法自动确定归属。请在设置中关联正确的会话。'});
        if(matches.length===1)return response('found',{...matches[0],complete:true,replacesMissingURL:wanted?data.url:undefined});
        return response('missing',{complete:true,count:seen.size});
      }
      await new Promise(r=>win.setTimeout(r,200));
    }
    return response('unknown',{error:'项目对话列表未加载完整或网页结构无法识别。原会话关联已保留，本次内容尚未发送。'});
  }
  projectDiagnostics(){
    const d=this.document,w=this.contentWindow;
    const visible=e=>!!e.getBoundingClientRect().width&&!!e.getBoundingClientRect().height;
    const meta=e=>({tag:e.localName,role:e.getAttribute('role'),test:e.getAttribute('data-testid'),id:e.id,href:e.getAttribute('href'),label:e.getAttribute('aria-label'),text:(e.innerText||e.textContent||'').slice(0,250),visible:visible(e),parents:[e.parentElement,e.parentElement?.parentElement,e.parentElement?.parentElement?.parentElement].filter(Boolean).map(p=>({tag:p.localName,role:p.getAttribute('role'),id:p.id,test:p.getAttribute('data-testid')}))});
    return {url:w.location.href,ready:d.readyState,mainCount:d.querySelectorAll('main').length,mains:[...d.querySelectorAll('main,[role="main"]')].map(meta),chats:[...d.querySelectorAll('a[href*="/c/"], [data-testid*="conversation"], [data-testid*="project"]')].map(meta).slice(0,100),headings:[...d.querySelectorAll('h1,h2,h3,[role="tab"],input,button')].filter(visible).map(meta).slice(0,90)};
  }
  titleDiagnostics(){
    const doc=this.document,url=this.contentWindow.location.href,id=url.match(/\/c\/([^/?#]+)/)?.[1];
    const meta=e=>({tag:e.localName,role:e.getAttribute('role'),test:e.getAttribute('data-testid'),label:e.getAttribute('aria-label'),title:e.getAttribute('title'),popup:e.getAttribute('aria-haspopup'),text:(e.innerText||'').trim().slice(0,70),visible:!!e.getBoundingClientRect().width});
    const links=[...doc.querySelectorAll('a[href]')].filter(a=>id&&!a.href.includes('#')&&a.href.match(/\/c\/([^/?#]+)/)?.[1]===id);
    return {actorVersion:'1.6.4',actorBuild:PAPER_WEB_ACTOR_BUILD,url,controls:[...doc.querySelectorAll('header button, nav button, button[aria-haspopup],button[data-testid],button[aria-label],[role="button"][aria-haspopup], [role="menuitem"]')].map(meta).filter(e=>e.visible).slice(0,60),currentChatRows:links.map(a=>{const parents=[];for(let p=a,n=0;p&&n<5;n++,p=p.parentElement){if([...p.querySelectorAll('a[href]')].some(other=>other.href.match(/\/c\/([^/?#]+)/)?.[1]&&other.href.match(/\/c\/([^/?#]+)/)?.[1]!==id))break;parents.push({tag:p.localName,test:p.getAttribute('data-testid'),role:p.getAttribute('role'),controls:[...p.querySelectorAll('button,[role="button"]')].map(meta)});}return {link:meta(a),parents};})};
  }
  async renameConversation(data){
    const doc=this.document,win=this.contentWindow;
    const id=url=>String(url||'').match(/^https:\/\/chatgpt\.com\/(?:g\/g-p-[a-zA-Z0-9-]+\/)?c\/([a-zA-Z0-9-]+)\/?(?:[?#].*)?$/)?.[1];
    const chatID=id(data.url),title=String(data.title||'').trim();
    if(!chatID||chatID!==id(win.location.href)||!title)return {renamed:false,reason:'wrong-conversation'};
    const visible=e=>!!e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&!e.disabled;
    const find=(root,selector,predicate=()=>true)=>[...root.querySelectorAll(selector)].find(e=>visible(e)&&predicate(e));
    const poll=async(fn)=>{for(let n=0;n<20;n++){if(id(win.location.href)!==chatID)return null;const result=fn();if(result)return result;await new Promise(r=>win.setTimeout(r,100));}return null;};
    const links=()=>[...doc.querySelectorAll('a[href]')].filter(e=>!e.href.includes('#')&&id(e.href)===chatID);
    const link=()=>links().find(visible)||links()[0];
    const confirmed=()=>links().some(a=>a.textContent?.trim()===title||a.getAttribute?.('aria-label')===title)||doc.title===title||doc.title===title+' - ChatGPT';
    if(confirmed())return {renamed:true,title,url:win.location.href};
    let row=link(),menu,openedSidebar=false;
    const rowSelector='button[aria-haspopup="menu"], button[data-testid*="conversation-options"], button[aria-label="Open conversation options"], button[aria-label="打开对话选项"], [role="button"][aria-haspopup="menu"], [role="button"][data-testid*="conversation-options"]';
    const resolveMenu=()=>{
      row=link();menu=null;
      for(let candidate=visible(row)?row:null,n=0;candidate&&n<5;n++,candidate=candidate.parentElement){
        const links=[...candidate.querySelectorAll('a[href]')].filter(a=>id(a.href));
        if(links.some(a=>id(a.href)!==chatID))break;
        row=candidate;
        // A conversation-row menu may be hidden until hover or rendered as a div.
        const rowMenu=[...candidate.querySelectorAll(rowSelector)].find(e=>!e.disabled);
        if(rowMenu){menu??=rowMenu;break;}
      }
      return menu;
    };
    // Rename belongs to the exact conversation row, not the page's “More” menu.
    const escape=()=>{if(id(win.location.href)!==chatID)return;const active=doc.activeElement;active?.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));};
    try{
      resolveMenu();
      if(!menu){
        const open=find(doc,'button[data-testid="open-sidebar-button"], button[aria-label="Open sidebar"], button[aria-label="打开边栏"], button[aria-label="打开侧边栏"], button[aria-label="显示侧边栏"], [role="button"][aria-label="Open sidebar"], [role="button"][aria-label="打开边栏"]');
        if(open){open.click();openedSidebar=true;await poll(resolveMenu);}
      }
      if(!menu&&link()&&win.MouseEvent){link().dispatchEvent(new win.MouseEvent('mouseover',{bubbles:true}));await poll(resolveMenu);}
      if(!menu)return {renamed:false,reason:'menu-unavailable'};
      menu.click();
      const findRename=()=>find(doc,'[role="menuitem"]',e=>/^(?:Rename(?: chat)?|重命名(?:聊天|对话)?)$/i.test(e.textContent.trim()));
      let rename=await poll(findRename);
      // Some menu components open on pointerdown rather than click.
      if(!rename&&id(win.location.href)===chatID&&menu.getAttribute?.('aria-expanded')!=='true'&&win.PointerEvent){
        menu.dispatchEvent(new win.PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true}));
        menu.dispatchEvent(new win.PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,buttons:0,pointerId:1,pointerType:'mouse',isPrimary:true}));
        rename=await poll(findRename);
      }
      if(!rename)return {renamed:false,reason:'rename-unavailable',menuState:{expanded:menu.getAttribute?.('aria-expanded')||null,items:[...doc.querySelectorAll('[role="menuitem"]')].filter(visible).map(e=>e.textContent.trim().slice(0,80)).slice(0,15)}};
      rename.click();
      const editor=await poll(()=>{
        const inline=row&&find(row,'input:not([type="hidden"])',e=>!['prompt-textarea','mobile-composer-prompt'].includes(e.id)&&!['email','password','search','file'].includes(e.type));
        return inline||find(doc,'[role="dialog"] input:not([type="hidden"]), input[data-testid="conversation-title-input"]',e=>!['prompt-textarea','mobile-composer-prompt'].includes(e.id)&&!['email','password','search','file'].includes(e.type));
      });
      if(!editor||editor.maxLength>0&&title.length>editor.maxLength)return {renamed:false,reason:'title-editor-unavailable'};
      editor.focus();
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype,'value').set.call(editor,title);
      editor.dispatchEvent(new win.Event('input',{bubbles:true}));
      const dialog=editor.closest('[role="dialog"]');
      const save=dialog&&find(dialog,'button',e=>/^(?:Save|保存|确认|Done)$/i.test(e.textContent.trim()));
      if(save)save.click();else{
        editor.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
        editor.dispatchEvent(new win.KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
      }
      const renamed=!!await poll(confirmed);return {renamed,title,url:win.location.href,reason:renamed?undefined:'save-unconfirmed'};
    }finally{
      escape();
      if(openedSidebar&&id(win.location.href)===chatID)find(doc,'button[data-testid="close-sidebar-button"], button[aria-label="Close sidebar"], button[aria-label="关闭边栏"], button[aria-label="关闭侧边栏"], button[aria-label="隐藏侧边栏"], [role="button"][aria-label="Close sidebar"]')?.click();
    }
  }
  projectRoute(url,home,entryOnly=false){
    const id=home.split('/')[4],match=String(url||'').match(/^https:\/\/chatgpt\.com\/g\/([^/]+)(\/project|\/c\/[a-zA-Z0-9-]+)?\/?(?:[?#].*)?$/);
    return !!match&&(match[1]===id||match[1].startsWith(id+'-'))&&(!entryOnly||!match[2]||match[2]==='/project');
  }
  pageAccess(){
    const doc=this.document,win=this.contentWindow;
    const visible=e=>!!e&&e.getBoundingClientRect?.().width>0&&e.getBoundingClientRect?.().height>0;
    const textOf=e=>typeof e.innerText==='string'?e.innerText:(e.textContent||'');
    const outsideReply=e=>!e.closest?.('article,[data-message-author-role],[data-turn],[data-testid*="conversation-turn"],.markdown,.prose,.markdown-body,[data-message-content-part]');
    const elements=selector=>[...doc.querySelectorAll(selector)].filter(e=>visible(e)&&outsideReply(e));
    const login=elements('a[href*="/auth/login"],a[href*="auth.openai.com"],button[data-testid="login-button"],button,a').some(e=>/^(?:log in|login|sign in|sign up|登录|登入|注册)$/i.test(textOf(e).trim()));
    if(login||/\/(?:auth|login)(?:\/|$)/.test(win.location.pathname||''))return {access:'login-required'};
    let notices=elements('[role="alert"],[role="alertdialog"],[role="status"],[data-sonner-toast],[data-testid*="error"],main h1,main h2');
    // A missing-chat page can render plain text instead of an alert. Restrict
    // this fallback to main content with no conversation turns, never a reply.
    if(!doc.querySelectorAll('[data-message-author-role],[data-turn],.turn-action-controls,article,.markdown,.prose,.markdown-body,[data-message-content-part]').length)notices=notices.concat(elements('main'));
    const pieces=notices.map(textOf);
    // The live site also uses ordinary div/span toast portals outside main,
    // without an alert role. Read visible text leaves, excluding chat history
    // and reply bodies; do not let a markdown class elsewhere hide the toast.
    if(doc.body&&doc.createTreeWalker){
      const walker=doc.createTreeWalker(doc.body,4);let leaf,count=0;
      while((leaf=walker.nextNode())&&count++<5000){
        const parent=leaf.parentElement,value=(leaf.nodeValue||'').trim();
        if(value&&visible(parent)&&outsideReply(parent)&&!parent.closest?.('nav,[data-testid*="sidebar"],#history,a[href*="/c/"]')&&(!win.getComputedStyle||win.getComputedStyle(parent).visibility!=='hidden'))pieces.push(value);
      }
    }
    const text=pieces.join(' ').replace(/\s+/g,' ');
    if(/(?:对话|会话|聊天).{0,12}(?:不存在|已被删除|已删除|未找到)|(?:找不到|无法找到|无法加载).{0,12}(?:对话|会话|聊天)|(?:conversation|chat).{0,24}(?:not found|does not exist|doesn't exist|deleted)|unable to load conversation|could not (?:find|load) (?:this |the )?conversation/i.test(text))return {access:'conversation-missing'};
    if(/(?:无权|没有权限|没有访问权限|无法访问).{0,12}(?:对话|会话|聊天)|(?:do not|don't|doesn't) have access to (?:this |the )?conversation|(?:conversation|chat).{0,24}(?:unavailable|inaccessible)|access (?:to this conversation )?denied/i.test(text))return {access:'conversation-unavailable'};
    if(/(?:network error|failed to fetch|check your (?:internet|network)|something went wrong|网络.{0,8}(?:错误|异常|连接)|出现了问题|出了点问题|project not found|项目.{0,8}(?:不存在|无法访问))/i.test(text))return {access:'page-error'};
    return {access:doc.readyState==='loading'?'loading':'ok'};
  }
  projectState(input, data) {
    const win=this.contentWindow,doc=this.document;
    const home=data.project, prefix=home.slice(0,-'/project'.length);
    const here=win.location.href.split(/[?#]/)[0].replace(/\/$/,'');
    const inProject=this.projectRoute(here,home);
    // Arm only the project composer, never the global New chat button/sidebar.
    this.projectWatch={project:home,token:data.token,input};
    if(!this.projectListener){
      this.projectListener=e=>{
        const watch=this.projectWatch;if(!watch)return;
        const p=watch.project.slice(0,-'/project'.length),url=win.location.href.split(/[?#]/)[0].replace(/\/$/,'');
        if(!this.projectRoute(url,watch.project,true))return;
        const send=e.target?.closest?.('button[data-testid="send-button"], button[aria-label="发送"], button[aria-label="发送消息"], button[aria-label="Send"], button[aria-label="Send prompt"], button[aria-label="Send message"]');
        const hasDraft=!!(watch.input?.value||watch.input?.textContent||'').trim();
        const composerTarget=e.target===watch.input||watch.input?.contains?.(e.target);
        if((send&&!send.disabled&&send.getAttribute?.('aria-disabled')!=='true')||(hasDraft&&e.type==='submit'&&e.target?.contains?.(watch.input))||(hasDraft&&composerTarget&&e.type==='keydown'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing))
          this.projectSubmission={token:watch.token,project:watch.project};
      };
      // The addon's .click() is an untrusted DOM event in privileged actor code.
      for(const name of ['click','submit','keydown'])doc.addEventListener(name,this.projectListener,true,true);
    }
    const access=this.pageAccess();
    return {actorBuild:PAPER_WEB_ACTOR_BUILD,url:win.location.href,loaded:doc.readyState==='complete',ready:!!input&&access.access==='ok',generating:!!doc.querySelector('button[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="停止生成"],button[aria-label="Stop response"]'),...access,inProject,empty:!!input&&!(input.value||input.textContent||'').trim(),project:home,submissionToken:this.projectSubmission?.project===home?this.projectSubmission.token:null};
  }
  readAnswers() {
    const doc = this.document;
    let turns = [...doc.querySelectorAll('[data-message-author-role="assistant"]')];
    if (!turns.length) turns = [...doc.querySelectorAll('article[data-turn="assistant"], [data-turn="assistant"]')];
    // Current ChatGPT renders assistant text and its action controls together,
    // without the older turn attributes. User messages have separate controls.
    const combinedTurns = !turns.length;
    if (combinedTurns) turns = [...doc.querySelectorAll('.turn-action-controls')].map(controls => controls.parentElement.firstElementChild).filter(Boolean);
    this.lastAnswerNode=null;
    return turns.map(turn => {
      const selector='.markdown, .prose, .markdown-body, [data-message-content-part]';
      const parts=[...turn.querySelectorAll?.(selector)||[]];
      const markdown = (combinedTurns?parts.at(-1):parts[0])||turn.querySelector(selector);
      // Writing cards expose an editable body; the title and action header are siblings.
      const editable=[...turn.querySelectorAll?.('[contenteditable="true"], [data-testid="writing-block-content"], [data-writing-block-content]')||[]].filter(e=>!['prompt-textarea','mobile-composer-prompt'].includes(e.id)&&!e.closest?.('form')&&!e.closest?.('[data-message-author-role="user"], [data-turn="user"]'));
      const writing=editable.find(e=>(e.innerText||e.textContent||'').trim());
      const roots=parts.filter(p=>!parts.some(other=>other!==p&&other.contains?.(p)));
      const body=writing||markdown;
      // A reply may have separate markdown blocks for an introduction and the
      // actual JSON/code block. Read every assistant block, avoiding nested
      // duplicates; preserve the dedicated body of a writing card.
      let text=writing?(writing.innerText||writing.textContent||'').trim():!combinedTurns&&roots.length?roots.map(p=>(p.innerText||p.textContent||'').trim()).filter(Boolean).join('\n\n'):(body||turn).innerText?.trim()||'';

      if (combinedTurns) {
        const labels = [...text.matchAll(/(?:^|\n)ChatGPT\s*(?:说[:：]|said:|says:)\s*/g)];
        if(labels.length){const last=labels.at(-1);text=text.slice(last.index+last[0].length).trim();}
        else if(!body)return "";
      }
      if(text)this.lastAnswerNode=turn;
      return text;
    }).filter(Boolean);
  }
  async waitForAnswer(before, beforeNode, timeoutMs = 35 * 60 * 1000) {
    const started = Date.now();
    let previous = "";
    let stableSince = 0;
    while (Date.now() - started < timeoutMs) {
      if (this.cancelled) throw new Error("已停止等待。回复仍可在网页查看。");
      await new Promise(resolve => this.contentWindow.setTimeout(resolve, 350));
      if(!['ok','loading'].includes(this.pageAccess().access))throw new Error('网页无法继续回复，请恢复访问后重试。');
      const answers = this.readAnswers();
      const latest=answers.at(-1)||'';
      // Older turns may leave the DOM, so a growing total is not required.
      const fresh=answers.length>before.length||latest!==before.at(-1)||this.lastAnswerNode!==beforeNode;
      const text = fresh ? latest : "";
      if (text) {
        if (text !== previous) { previous = text; stableSince = Date.now(); }
        const generating = this.document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="停止生成"], button[aria-label="Stop response"], button[aria-label="Stop streaming"], button[aria-label="停止流式传输"], button[aria-label="停止"]');
        const streaming=this.lastAnswerNode?.querySelector?.('[data-is-streaming="true"], [data-streaming="true"], [aria-busy="true"]')||this.lastAnswerNode?.getAttribute?.('data-is-streaming')==='true'||this.lastAnswerNode?.getAttribute?.('aria-busy')==='true';
        if (!generating && !streaming && Date.now() - stableSince > 1800) return { text, sent:true, url:this.contentWindow.location.href,project:this.projectSubmission?.project,submissionToken:this.projectSubmission?.token };
      }
    }
    throw new Error("等待网页回复超时，请在侧栏网页查看状态。");
  }
  async receiveMessage(message) {
    if (this.contentWindow.location.hostname !== "chatgpt.com") throw new Error("请先完成登录并回到 ChatGPT。");
    const doc = this.document;
    const win = this.contentWindow;
    if(['PaperWeb:Draft','PaperWeb:Send','PaperWeb:SendAndWait','PaperWeb:Upload'].includes(message.name)){
      const access=this.pageAccess().access;
      if(!['ok','loading'].includes(access)){
        const error=access==='login-required'?'请先在侧栏登录正确的 ChatGPT 账号。':access==='page-error'?'ChatGPT 网页或网络异常，请恢复后重试。':'当前对话不存在或无法访问，请重新运行操作以核实并恢复会话。';
        if(['PaperWeb:Send','PaperWeb:SendAndWait'].includes(message.name))return {sent:false,access,error};
        throw new Error(error);
      }
    }
    if(message.name==='PaperWeb:ProjectDiagnostics')return this.projectDiagnostics();
    if(message.name==='PaperWeb:TitleDiagnostics')return this.titleDiagnostics();
    if(message.name==='PaperWeb:VerifyProjectConversation')return this.verifyProjectConversation(message.data);
    if(message.name==='PaperWeb:RenameConversation'){if(this.pageAccess().access!=='ok')return {renamed:false,reason:'conversation-unavailable'};return this.renameConversation(message.data);}
    if(message.name==='PaperWeb:WaitForAnswer'){
      const pending=this.pendingReply;
      if(!pending||pending.token!==message.data.token)throw new Error('本次发送的等待记录不可用，请在网页查看回复。');
      try{return await this.waitForAnswer(pending.before,pending.beforeNode,message.data.timeoutMs);}finally{if(this.pendingReply===pending)this.pendingReply=null;}
    }
    if (message.name === "PaperWeb:Answer") return {text:this.readAnswers().at(-1)||"",url:win.location.href};
    if (message.name === "PaperWeb:Cancel") {
      this.cancelled=true;
      doc.querySelector('button[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="停止生成"],button[aria-label="Stop response"]')?.click();
      return {stopped:true};
    }
    if (message.name === "PaperWeb:Upload") {
      const files=message.data.files||[];
      const accepts=(input,f)=>!input.accept||input.accept.split(',').some(v=>{v=v.trim().toLowerCase();return v===f.type||v.endsWith('/*')&&String(f.type||'').startsWith(v.slice(0,-1))||v.startsWith('.')&&f.name.toLowerCase().endsWith(v);});
      const input=[...doc.querySelectorAll('input[type="file"]')].find(i=>files.every(f=>accepts(i,f)));
      if(!input) throw new Error("请先点击网页输入框旁的“添加文件”，再点击助手的上传按钮。");
      const transfer=new win.DataTransfer();
      for(const f of files) {
        const bytes=Uint8Array.from(win.atob(f.base64),c=>c.charCodeAt(0));
        transfer.items.add(new win.File([bytes],f.name,{type:f.type||'application/octet-stream'}));
      }
      input.files=transfer.files;
      input.dispatchEvent(new win.Event('change',{bubbles:true}));
      return {attached:transfer.files.length};
    }
    if (message.name === "PaperWeb:Send" || message.name === "PaperWeb:SendAndWait") {
      this.cancelled=false;
      const before = this.readAnswers();
      const beforeNode=this.lastAnswerNode;
      let button;
      for (let attempt = 0; attempt < 150; attempt++) {
        if(this.cancelled)return {sent:false,error:'任务已停止。'};
        const access=this.pageAccess().access;
        if(['conversation-missing','conversation-unavailable'].includes(access))return {sent:false,access,error:'当前对话不存在或无法访问，本次内容尚未发送。'};
        if(['login-required','page-error'].includes(access))return {sent:false,access,error:access==='login-required'?'请先登录正确的 ChatGPT 账号。':'ChatGPT 网页或网络异常，请恢复后重试。'};
        button = [...doc.querySelectorAll('button[data-testid="send-button"], button[aria-label="发送"], button[aria-label="发送消息"], button[aria-label="Send"], button[aria-label="Send prompt"], button[aria-label="Send message"]')].find(el => el.getBoundingClientRect().width > 0 && !el.disabled && el.getAttribute("aria-disabled") !== "true");
        if (button) break;
        await new Promise(resolve => win.setTimeout(resolve, 100));
      }
      if (!button) return {sent:false,error:"已填入提示词，网页发送按钮尚未就绪，请稍后重试。"};
      if(this.cancelled)return {sent:false,error:'任务已停止。'};
      // Confirm at the actual send operation, independently of DOM event propagation.
      const request=message.data||{},home=request.project||this.projectWatch?.project;
      const prefix=home?.slice(0,-'/project'.length),here=win.location.href.split(/[?#]/)[0].replace(/\/$/,'');
      if(home&&this.projectRoute(here,home,true))this.projectSubmission={project:home,token:request.token||this.projectWatch?.token};
      this.pendingReply={before,beforeNode,token:request.token||this.projectWatch?.token};
      button.click();
      if (message.name === "PaperWeb:SendAndWait") return this.waitForAnswer(before,beforeNode);
      return { sent: true,url:win.location.href,project:this.projectSubmission?.project,submissionToken:this.projectSubmission?.token };
    }
    const candidates = [...doc.querySelectorAll('#prompt-textarea, #mobile-composer-prompt, textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]')];
    const eligible=candidates.filter(el=>el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0&&!el.disabled&&!el.readOnly&&win.getComputedStyle(el).visibility==='visible');
    // ChatGPT can render editable answer blocks as well as its composer.
    const input=eligible.find(el=>['prompt-textarea','mobile-composer-prompt'].includes(el.id))||eligible.find(el=>el.closest('form'))||eligible.filter(el=>!el.closest('article,[data-message-author-role],[data-testid*="conversation-turn"]')).at(-1);
    if (message.name === 'PaperWeb:ProjectState') return this.projectState(input,message.data);
    if (message.name === 'PaperWeb:OpenProjectComposer') {
      const home=message.data.project,prefix=home.slice(0,-'/project'.length);
      const here=win.location.href.split(/[?#]/)[0].replace(/\/$/,'');
      if(!this.projectRoute(here,home,true))throw new Error('请先打开目标项目主页。');
      if(input)return {ready:true};
      const target=[...doc.querySelectorAll('main a[href], main button')].find(e=>{
        if(!e.getBoundingClientRect().width||e.disabled)return false;
        if(e.localName==='a')return this.projectRoute(e.href,home,true)&&!e.href.split(/[?#]/)[0].replace(/\/$/,'').endsWith('/project');
        const label=e.getAttribute('aria-label')||e.innerText||'';
        return /(?:new chat in|新.*聊天|新.*对话)/i.test(label);
      });
      target?.click();return {clicked:!!target};
    }
    if (message.name === "PaperWeb:Inspect") return JSON.parse(JSON.stringify({
      ready: !!input, input: input ? { tag: input.localName, id: input.id, editable: input.getAttribute("contenteditable"), empty: !(input.value || input.textContent || "").trim() } : null, answerCount: this.readAnswers().length,
      answerLengths: this.readAnswers().map(text => text.length),fileInputs:[...doc.querySelectorAll('input[type="file"]')].map(i=>({accept:i.accept,multiple:i.multiple,files:i.files.length}))
    }));
    if(message.name==='PaperWeb:FocusComposer'){
      const access=this.pageAccess().access;
      if(access!=='ok'||!input)return {focused:false};
      input.focus();input.scrollIntoView({block:'nearest'});return {focused:true};
    }
    if (message.name !== "PaperWeb:Draft") throw new Error("Unsupported action");
    if (!input) throw new Error("网页输入框尚未就绪，请等待加载或完成登录。");
    if ((input.value || input.textContent || "").trim()) throw new Error("网页中已有未发送的内容，请先发送或清空它。");
    const text = String(message.data.text || "");
    if (!text.trim()) throw new Error("提示词为空。");
    input.focus();
    if (input.localName === "textarea" || input.localName === "input") {
      const proto = input.localName === "textarea" ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(input, text);
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
    } else {
      const selection = win.getSelection();
      const range = doc.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!doc.execCommand("insertText", false, text)) throw new Error("网页未接受输入，请在网页中手动输入。");
    }
    return { filled: true };
  }
}

