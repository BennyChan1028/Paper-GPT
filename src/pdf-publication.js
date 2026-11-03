/* Publish a verified PDF before removing older translations of the same source. */
var PaperPDFPublication=(()=>{
  const active=new Set();
  const canonical=p=>Zotero.isWin?PathUtils.normalize(p).toLowerCase():PathUtils.normalize(p);
  const digest=p=>IOUtils.computeHexDigest(p,'sha256');
  const read=async p=>JSON.parse(await IOUtils.readUTF8(p));
  const write=(p,value)=>IOUtils.writeUTF8(p,JSON.stringify(value),{tmpPath:p+'.tmp'});
  const sourceKey=a=>a.libraryID+'-'+String(a.key||a.id).replace(/[^A-Za-z0-9_-]/g,'');
  function family(name,base){
    name=String(name||'').replace(/\.pdf$/i,'');base=String(base).replace(/\.pdf$/i,'');
    if(Zotero.isWin){name=name.toLowerCase();base=base.toLowerCase();}
    if(name===base)return true;
    const tail=name.startsWith(base)?name.slice(base.length):'';
    // Legacy automatic suffixes; do not mistake publication years for copies.
    return /^(?: \((?:[2-9]|[1-9]\d)\)|-(?:[2-9]|[1-9]\d))$/.test(tail);
  }
  async function plan(attachment,input,destination,automatic){
    const root=PathUtils.join(Zotero.DataDirectory.dir,'paper-gpt','pdf-export','exports');
    await IOUtils.makeDirectory(root,{ignoreExisting:true,createAncestors:true});
    const registry=PathUtils.join(root,sourceKey(attachment)+'.json');let prior=[];
    if(await IOUtils.exists(registry)){
      const saved=await read(registry);
      if(saved.source!==sourceKey(attachment)||!Array.isArray(saved.records))throw Error('中文 PDF 保存记录无效，旧版本已保留。');
      prior=saved.records;
    }
    const base=PathUtils.filename(destination),sourceFolder=canonical(PathUtils.parent(input)),files=new Map(),items=[];
    const remember=async path=>{
      if(!path||!PathUtils.isAbsolute(path)||canonical(path)===canonical(input)||canonical(PathUtils.parent(path))!==sourceFolder||!family(PathUtils.filename(path),base))return;
      if(await IOUtils.exists(path))files.set(canonical(path),{path,sha256:await digest(path)});
    };
    if(automatic){
      for(const path of await IOUtils.getChildren(PathUtils.parent(input)))if(family(PathUtils.filename(path),base))await remember(path);
      const parent=attachment.parentID?Zotero.Items.get(attachment.parentID):null;
      const candidates=parent?parent.getAttachments().map(id=>Zotero.Items.get(id)):prior.map(r=>Zotero.Items.getByLibraryAndKey(attachment.libraryID,r.attachmentKey));
      for(const item of candidates){
        if(!item||item.id===attachment.id||item.deleted||item.libraryID!==attachment.libraryID||!item.isPDFAttachment?.()||item.parentID!==attachment.parentID)continue;
        const known=prior.some(r=>r.attachmentKey===item.key);
        const path=await item.getFilePathAsync();
        if(!known&&!family(item.getField('title'),base)&&!family(path?PathUtils.filename(path):'',base))continue;
        if(!item.isEditable()||path&&canonical(path)===canonical(input))throw Error('旧中文附件不可替换，原文件已保留。');
        if(path&&item.isStoredFileAttachment()&&canonical(PathUtils.parent(path))===sourceFolder)throw Error('旧中文附件与原文共用存储目录，原文件已保留。');
        items.push({item,path,sha256:path&&await IOUtils.exists(path)?await digest(path):null});
        await remember(path);
      }
      for(const record of prior){
        if(!record.attachmentPath||record.attachmentKey===attachment.key||Zotero.Items.getByLibraryAndKey(attachment.libraryID,record.attachmentKey))continue;
        const directory=Zotero.Attachments.getStorageDirectoryByLibraryAndKey(attachment.libraryID,record.attachmentKey).path;
        const path=record.attachmentPath;
        if(canonical(PathUtils.parent(path))!==canonical(directory)||canonical(path)===canonical(input)||canonical(path)===canonical(destination))continue;
        if(await IOUtils.exists(path)&&await digest(path)===record.sha256)files.set(canonical(path),{path,sha256:record.sha256});
      }
    }
    return {registry,prior,files:[...files.values()],items};
  }
  async function publish({attachment,output,destination,automatic,sourceHash,register}){
    const key=sourceKey(attachment);if(active.has(key))throw Error('这篇论文已有中文 PDF 正在保存，请稍后重试。');
    active.add(key);
    let staged,backup,publishedHash,stagedCreated=false,movedOld=false,movedNew=false,newID,committed=false;
    try{
      const input=await attachment.getFilePathAsync();
      if(!input||canonical(input)===canonical(destination))throw Error('不能覆盖原文。');
      if(await digest(input)!==sourceHash)throw Error('原 PDF 已改变，旧中文版本已保留，请重新导出。');
      if(!automatic&&await IOUtils.exists(destination))throw Error('所选文件已存在，请换一个文件名。');
      const old=await plan(attachment,input,destination,automatic),newHash=await digest(output);
      publishedHash=newHash;
      const oldHash=await IOUtils.exists(destination)?await digest(destination):null;
      const id=Services.uuid.generateUUID().toString().replace(/[{}]/g,'');
      staged=PathUtils.join(PathUtils.parent(destination),'.pgpdf-'+id+'-new.pdf');
      backup=PathUtils.join(PathUtils.parent(destination),'.pgpdf-'+id+'-old.pdf');
      await IOUtils.copy(output,staged,{noOverwrite:true});
      stagedCreated=true;
      if(await digest(staged)!==newHash)throw Error('新 PDF 文件校验失败，旧版本已保留。');
      if(oldHash){
        if(await digest(destination)!==oldHash)throw Error('旧中文文件正在被修改，已停止替换。');
        await IOUtils.move(destination,backup,{noOverwrite:true});movedOld=true;
      }
      await IOUtils.move(staged,destination,{noOverwrite:true});movedNew=true;
      newID=await register(attachment,destination);
      if(canonical(await attachment.getFilePathAsync())!==canonical(input)||await digest(input)!==sourceHash)throw Error('原 PDF 在保存期间已改变，旧中文版本已保留。');
      const item=Zotero.Items.get(newID),record={attachmentKey:item.key,path:destination,attachmentPath:await item.getFilePathAsync(),sha256:newHash};
      const legacy=old.items.map(e=>({attachmentKey:e.item.key,attachmentPath:e.path,sha256:e.sha256}));
      if(automatic)await write(old.registry,{source:key,records:[record,...old.prior,...legacy]});
      committed=true;
      const failures=[];let removed=0;
      if(automatic){
        for(const entry of old.items){
          try{
            if(entry.item.id===newID||entry.item.id===attachment.id)continue;
            if(entry.item.parentID!==attachment.parentID||entry.item.libraryID!==attachment.libraryID)throw Error('旧中文附件已移动，未删除。');
            // A linked old attachment can point at the stable output path,
            // whose previous bytes are now in backup, not at destination.
            const oldPath=entry.path&&canonical(entry.path)===canonical(destination)?backup:entry.path;
            if(oldPath&&await IOUtils.exists(oldPath)&&await digest(oldPath)!==entry.sha256)throw Error('旧中文附件已被修改，未删除：'+entry.item.getField('title'));
            await entry.item.eraseTx();removed++;
            if(entry.path&&entry.sha256&&await IOUtils.exists(entry.path)&&canonical(entry.path)!==canonical(input)&&canonical(entry.path)!==canonical(destination)&&await digest(entry.path)===entry.sha256)await IOUtils.remove(entry.path,{ignoreAbsent:true});
          }catch(e){failures.push(e.message);Zotero.logError(e);}
        }
        for(const entry of old.files){
          if(canonical(entry.path)===canonical(destination)||canonical(entry.path)===canonical(input))continue;
          try{
            if(await IOUtils.exists(entry.path)){
              if(await digest(entry.path)!==entry.sha256)throw Error('旧中文文件已被修改，未删除：'+PathUtils.filename(entry.path));
              await IOUtils.remove(entry.path,{ignoreAbsent:true});removed++;
            }
          }catch(e){failures.push(e.message);Zotero.logError(e);}
        }
        if(!failures.length)try{await write(old.registry,{source:key,records:[record]});}catch(e){Zotero.logError(e);}
      }
      return {path:destination,attachmentID:newID,replaced:removed,cleanupWarning:failures.length?failures.join('；'):undefined};
    }catch(e){
      if(!committed){
        if(newID)try{await Zotero.Items.get(newID).eraseTx();}catch(error){Zotero.logError(error);}
        if(movedNew)try{if(await IOUtils.exists(destination)&&await digest(destination)===publishedHash)await IOUtils.remove(destination,{ignoreAbsent:true});}catch(error){Zotero.logError(error);}
        if(movedOld)try{await IOUtils.move(backup,destination,{noOverwrite:true});movedOld=false;}catch(error){e.message+='；旧版备份保留在 '+backup;Zotero.logError(error);}
      }
      throw e;
    }finally{
      if(stagedCreated)await IOUtils.remove(staged,{ignoreAbsent:true}).catch(e=>Zotero.logError(e));
      if(committed&&movedOld)await IOUtils.remove(backup,{ignoreAbsent:true}).catch(e=>Zotero.logError(e));
      active.delete(key);
    }
  }
  return {publish,family};
})();
