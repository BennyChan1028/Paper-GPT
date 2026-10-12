/* Native Paper GPT controls for independent journal, reading and AI metadata tools. */
var PaperLibraryUI = (() => {
  const element=(doc,tag,text)=>{const e=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text)e.textContent=text;return e;};
  function mount(s,{targets,generate,closeOthers}){
    const doc=s.doc,panel=element(doc,'section');panel.className='pwa-control pwa-library';panel.hidden=true;panel.id='pwa-library-'+Date.now()+'-'+Math.random().toString(36).slice(2);panel.setAttribute('role','region');panel.setAttribute('aria-label','文库与阅读工具');s.library=panel;s.root.append(panel);
    const message=text=>{s.libraryMessage.textContent=text;};
    const action=(parent,label,fn,locked=false)=>{const b=element(doc,'button',label);b.type='button';b.dataset.uiToggle='true';b.addEventListener('click',()=>{if(locked&&s.busy)return;Promise.resolve().then(fn).catch(e=>message(e.message||String(e)));});parent.append(b);if(locked)s.lockControls.push(b);return b;};
    const heading=element(doc,'div');heading.className='pwa-heading';heading.append(element(doc,'strong','文库与阅读'));panel.append(heading);action(heading,'收起',()=>close(s,true));
    const title=element(doc,'p');title.className='pwa-library-paper';panel.append(title);
    s.libraryMessage=element(doc,'p');s.libraryMessage.className='pwa-status';s.libraryMessage.setAttribute('role','status');panel.append(s.libraryMessage);
    const section=name=>{const e=element(doc,'section');e.className='pwa-library-section';e.append(element(doc,'h3',name));panel.append(e);return e;};
    const reading=section('阅读时长与进度'),stats=element(doc,'p'),progress=element(doc,'progress');progress.max=100;progress.setAttribute('aria-label','PDF 已浏览页覆盖率');reading.append(stats,progress);
    const detail=element(doc,'p');detail.className='pwa-hint';reading.append(detail);
    const recording=element(doc,'input');recording.type='checkbox';recording.checked=PaperLibraryTools.recording;const recordLabel=element(doc,'label');recordLabel.className='pwa-checkbox';recordLabel.append(recording,doc.createTextNode('记录阅读时长'));reading.append(recordLabel);recording.addEventListener('change',()=>{PaperLibraryTools.setRecording(recording.checked);message(recording.checked?'已开启，仅计入前台且非空闲的 PDF 阅读。':'已暂停，不再记录新的阅读活动。');});
    const migrate=element(doc,'details');migrate.className='pwa-details';migrate.append(element(doc,'summary','迁移原 Style 阅读记录'));reading.append(migrate);
    migrate.append(element(doc,'p','只读取所选文献的旧数据，保存到 Paper GPT，不修改原记录。建议先停用 Style，再立即迁移，避免重复计时。'));
    action(migrate,'导入所选文献的旧记录',async()=>{const items=targets();if(!Services.prompt.confirm(s.win,'导入旧阅读记录','将为以下文献导入阅读记录快照（重复导入会更新同一快照）：\n'+items.map(i=>i.getDisplayTitle()).join('\n')))return;const count=await PaperLibraryTools.importLegacy(items);message('已导入 '+count+' 篇文献的阅读记录。');});

    const journals=section('期刊分区与影响因子'),journalInfo=element(doc,'div');journalInfo.className='pwa-journal-info';journals.append(journalInfo);
    const query=action(journals,'查询 / 更新期刊数据',async()=>{const selected=targets();query.disabled=true;try{const result=await PaperLibraryTools.lookupMany(selected,{onProgress:p=>message('正在查询 '+p.completed+'/'+p.total+' 篇'+(p.journal?' · '+p.journal:''))});update();message(PaperLibraryTools.batchText(result));s.libraryMessage.title=PaperLibraryTools.batchDetails(result);}finally{query.disabled=PaperLibraryTools.journalBusy;}});
    const settings=element(doc,'details');settings.className='pwa-details';settings.append(element(doc,'summary','期刊数据设置'));journals.append(settings);
    settings.append(element(doc,'p','期刊名和密钥只发送到 easyScholar。评级年份以数据源为准，查询日期不代表统计年份。'));
    const secret=element(doc,'input');secret.type='password';secret.autocomplete='off';secret.setAttribute('aria-label','easyScholar 密钥');settings.append(secret);
    const keyActions=element(doc,'div');keyActions.className='pwa-actions';settings.append(keyActions);
    action(keyActions,'保存密钥',()=>{if(!secret.value.trim())throw new Error('请输入密钥；如需移除，请点“清除密钥”。');PaperLibraryTools.saveKey(secret.value);secret.value='';update();message('已保存密钥。');});
    action(keyActions,'导入原 Style 密钥',()=>{PaperLibraryTools.importKey();update();message('已复制原密钥到 Paper GPT，以后不依赖 Style 运行。');});
    action(keyActions,'清除密钥',()=>{PaperLibraryTools.saveKey('');secret.value='';update();message('已清除 Paper GPT 的期刊密钥。');});

    const ai=section('AI 标签与简记');ai.append(element(doc,'p','生成后直接保存：标签追加到 Zotero 原生标签，简记写入简记列。优先使用条目摘要，缺失时读取本地 PDF；无法读取的文献单独提示。一次最多 10 篇，共用“AI 摘要”对话。'));
    const aiActions=element(doc,'div');aiActions.className='pwa-tool-grid';ai.append(aiActions);
    action(aiActions,'AI 生成标签',()=>generate('tags'),true);action(aiActions,'AI 生成简记',()=>generate('remark'),true);
    const draft=element(doc,'div');draft.className='pwa-ai-draft';draft.hidden=true;ai.append(draft);s.libraryDraft=draft;
    const remark=element(doc,'p');remark.className='pwa-current-remark';ai.append(remark);
    const columns=section('文库列表');columns.append(element(doc,'p','在文献列表表头右键，可开启期刊评级、阅读时长、阅读进度和简记列。AI 标签使用 Zotero 原生标签。'));
    function update(){
      query.disabled=PaperLibraryTools.journalBusy;
      const item=s.item,value=PaperLibraryTools.summary(item);title.textContent=s.sessionTitle||'请先选择文献';stats.textContent='阅读时长 '+PaperLibraryTools.duration(value.seconds);progress.value=value.percent;
      detail.textContent=value.pageCount?'已浏览 '+value.visited+' / '+value.pageCount+' 页（'+value.percent+'%），仅表示浏览覆盖。':'打开 PDF 后自动记录；切出 Zotero 或空闲两分钟后暂停计时。';
      recording.checked=PaperLibraryTools.recording;secret.placeholder=PaperLibraryTools.hasKey?'已配置；填写新密钥可替换':'填写 easyScholar Secret Key';
      journalInfo.replaceChildren();
      if(value.journal){
        const labels={sciif:'影响因子',sci:'SCI / JCR 分区',ssci:'SSCI 分区',sciUp:'中科院',sciBase:'中科院基础版',cssci:'CSSCI',pku:'北大核心',sciif5:'五年影响因子',jci:'JCI',ccf:'CCF',ajg:'AJG'};
        const data=element(doc,'dl');for(const [field,text]of Object.entries(value.journal.ranks)){data.append(element(doc,'dt',labels[field]||field),element(doc,'dd',text));}journalInfo.append(data,element(doc,'p','来源：easyScholar · 查询日期：'+value.journal.fetchedAt.slice(0,10)));
      }else journalInfo.append(element(doc,'p','尚未查询此期刊。可在这里配置密钥后查询。'));
      remark.textContent=value.remark?'当前简记：'+value.remark:'尚未保存简记。';
      if(value.error)message(value.error);
    }
    s.libraryUpdate=update;s.libraryUnsubscribe=PaperLibraryTools.subscribe(()=>{if(!panel.hidden)update();});update();
    s.openLibrary=()=>{closeOthers();panel.hidden=false;s.libraryButton.setAttribute('aria-expanded','true');update();heading.querySelector('button').focus();};
    s.showLibraryResult=(kind,rows,items,evidence)=>{
      draft.replaceChildren();draft.hidden=false;draft.append(element(doc,'h4',kind==='tags'?'标签已保存':'简记已写入'));
      for(const row of rows){const item=items.find(i=>i.id===row.id),entry=element(doc,'div');entry.className='pwa-ai-draft-row';entry.append(element(doc,'strong',item.getDisplayTitle()),element(doc,'p',kind==='tags'?row.tags.join('、'):row.remark));const source=evidence?.materials.find(v=>v.id===row.id);if(source){const label=element(doc,'p','依据：'+PaperLibraryTools.sourceLabel(source));label.className='pwa-hint';label.title=source.coverage;entry.append(label);if(source.source==='pdf-excerpt')entry.append(element(doc,'p','材料限于 PDF 前 8 页内的原文片段。'));}draft.append(entry);}
      if(evidence?.skipped.length){draft.append(element(doc,'h4','未生成的文献'));for(const value of evidence.skipped)draft.append(element(doc,'p',value.title+'：'+value.reason));}
      s.openLibrary();draft.scrollIntoView({block:'nearest'});
    };

  }
  function close(s,focus=false){if(!s.library)return;s.library.hidden=true;s.libraryButton.setAttribute('aria-expanded','false');if(focus)(s.options?.hidden?s.optionsButton:s.libraryButton).focus();}
  return {mount,close};
})();
