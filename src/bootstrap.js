var paperScope;
function install() {}
async function startup({rootURI}) {
  await Zotero.uiReadyPromise;
  paperScope={Zotero,Services,Components,ChromeUtils,IOUtils,PathUtils};
  Services.scriptloader.loadSubScriptWithOptions(rootURI+'compat.js',{target:paperScope,charset:'UTF-8',ignoreCache:true});
  Services.scriptloader.loadSubScriptWithOptions(rootURI+'controls.js',{target:paperScope,charset:'UTF-8',ignoreCache:true});
  Services.scriptloader.loadSubScriptWithOptions(rootURI+'sessions.js',{target:paperScope,charset:'UTF-8',ignoreCache:true});
  Services.scriptloader.loadSubScriptWithOptions(rootURI+'help.js',{target:paperScope,charset:'UTF-8',ignoreCache:true});
  Services.scriptloader.loadSubScriptWithOptions(rootURI+'library-tools.js',{target:paperScope,charset:'UTF-8',ignoreCache:true});
  Services.scriptloader.loadSubScriptWithOptions(rootURI+'library-ui.js',{target:paperScope,charset:'UTF-8',ignoreCache:true});
  Services.scriptloader.loadSubScriptWithOptions(rootURI+'paragraphs.js',{target:paperScope,charset:'UTF-8',ignoreCache:true});
  Services.scriptloader.loadSubScriptWithOptions(rootURI+'assistant.js',{target:paperScope,charset:'UTF-8',ignoreCache:true});
  await paperScope.PaperWebAssistant.start(rootURI);
  try{await paperScope.PaperLibraryTools.start();}catch(e){Zotero.logError(e);}
  paperScope.AnnotationPopupControls.start();
  Zotero.__PaperWebAssistant=paperScope.PaperWebAssistant;
}
async function shutdown() {
  paperScope?.AnnotationPopupControls?.stop();
  paperScope?.PaperWebAssistant?.stop();
  try{await paperScope?.PaperLibraryTools?.stop();}catch(e){Zotero.logError(e);}
  if(Zotero.__PaperWebAssistant===paperScope?.PaperWebAssistant) delete Zotero.__PaperWebAssistant;
  paperScope=null;
}
function uninstall() {}
