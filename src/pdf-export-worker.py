"""Local BabelDOC adapter. Translation requests are handled by Zotero's web UI.

No translation API, browser cookies, account tokens or network listener are used.
BabelDOC is an independently installed AGPL-3.0 dependency; see THIRD_PARTY.md.
"""
from pathlib import Path
import argparse,contextlib,hashlib,json,logging,os,re,sys,threading,time,uuid

ENGINE_VERSION='0.6.4'
def fs_path(path):
    value=str(Path(path).absolute())
    if os.name=='nt' and not value.startswith('\\\\?\\'):
        value='\\\\?\\UNC\\'+value[2:] if value.startswith('\\\\') else '\\\\?\\'+value
    return Path(value)

def is_references_heading(text):
    text=re.sub(r'\s+',' ',text or '').strip()
    text=re.sub(r'^(?:(?:\d+|[IVXLCDM]+)[.)、]?\s+)', '',text,flags=re.I).strip(' .:：')
    return bool(re.fullmatch(r'references(?: and notes)?|bibliography|literature cited|参考文献',text,re.I))

def atomic_json(path,value):
    path=fs_path(path);path.parent.mkdir(parents=True,exist_ok=True)
    # A short sibling temp name avoids exceeding legacy Windows path limits
    # when the Zotero directory and two SHA-256 cache keys are already long.
    tmp=path.with_name('.'+uuid.uuid4().hex[:12]+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False),'utf8');os.replace(tmp,path)

def configure_assets(path):
    # Set before importing the rendering pipeline, whose modules copy these constants.
    import babeldoc.const as const
    const.CACHE_FOLDER=Path(path);const.CACHE_FOLDER.mkdir(parents=True,exist_ok=True)
    const.TIKTOKEN_CACHE_FOLDER=const.CACHE_FOLDER/'tiktoken';const.TIKTOKEN_CACHE_FOLDER.mkdir(exist_ok=True)
    os.environ['TIKTOKEN_CACHE_DIR']=str(const.TIKTOKEN_CACHE_FOLDER)

class FileBridge:
    def __init__(self,job,cache):
        self.job=fs_path(job);self.queue=self.job/'queue';self.queue.mkdir(exist_ok=True)
        self.cache=fs_path(cache);self.cache.mkdir(parents=True,exist_ok=True)
        self.lock=threading.Lock();self.failed=False;self.completed=0;self.reused=0;self.web_requests=0
    def cancelled(self):return (self.job/'cancel.json').exists()
    @staticmethod
    def key(text):return hashlib.sha256(('paper-gpt-web-v1\0'+text).encode()).hexdigest()
    @staticmethod
    def tokens(text):return sorted(re.findall(r'</?b\d+>',text))
    def translate(self,text):return self.translate_page([text],None)[0] if text else text
    def translate_page(self,texts,page):
        with self.lock:
            if self.cancelled():raise RuntimeError('Export cancelled')
            values={};missing={}
            for text in texts:
                key=self.key(text)
                if key in values:self.reused+=1;continue
                cached=self.cache/(key+'.json')
                if cached.exists():
                    saved=json.loads(cached.read_text('utf8'))
                    value=saved.get('translation')
                    if saved.get('source')==text and isinstance(value,str) and value.strip() and self.tokens(text)==self.tokens(value):
                        values[key]=value;self.reused+=1;continue
                missing[key]={'id':key[:24],'text':text}
            if not missing:return [values[self.key(text)] for text in texts]
            request_id=uuid.uuid4().hex;request=self.queue/(request_id+'.request.json');reply=self.queue/(request_id+'.reply.json')
            atomic_json(request,{'id':request_id,'items':list(missing.values()),'page':page,'mode':'page-translation'})
            expected={item['id']:(key,item['text']) for key,item in missing.items()};accepted={}
            if len(expected)!=len(missing):raise RuntimeError('Page paragraph ID collision')
            def accept(rows,partial=False):
                if not isinstance(rows,list):raise RuntimeError('Missing page translations')
                seen=set()
                for row in rows:
                    rid=row.get('id');value=row.get('translation')
                    if rid not in expected or rid in seen or not isinstance(value,str) or not value.strip():raise RuntimeError('Invalid page translation ID or content')
                    seen.add(rid)
                    if self.tokens(expected[rid][1])!=self.tokens(value):raise RuntimeError('Formula/style placeholders changed; PDF not published')
                    if rid in accepted and accepted[rid]!=value.strip():raise RuntimeError('Completed page translation changed')
                if not partial and seen!=set(expected):raise RuntimeError('Incomplete page translation')
                for row in rows:
                    rid=row['id']
                    if rid in accepted:continue
                    key,text=expected[rid];value=row['translation'].strip()
                    atomic_json(self.cache/(key+'.json'),{'source':text,'translation':value})
                    accepted[rid]=value;values[key]=value;self.completed+=1
            until=time.monotonic()+900
            checkpoint=self.queue/(request_id+'.partial.json');last_checkpoint=''
            try:
                while True:
                    if self.cancelled() or time.monotonic()>until:raise RuntimeError('Export cancelled or webpage reply timed out; no PDF published')
                    if checkpoint.exists():
                        content=checkpoint.read_text('utf8')
                        if content!=last_checkpoint:
                            part=json.loads(content)
                            if part.get('id')!=request_id:raise RuntimeError('Invalid checkpoint owner')
                            accept(part.get('translations'),True);last_checkpoint=content
                    if reply.exists():break
                    time.sleep(.15)
                result=json.loads(reply.read_text('utf8'))
                if result.get('id')!=request_id or result.get('error'):raise RuntimeError(result.get('error') or 'Invalid webpage reply')
                accept(result.get('translations'));self.web_requests+=int(result.get('webRequests',1))
                return [values[self.key(text)] for text in texts]
            except BaseException:self.failed=True;raise

def probe():
    import importlib.metadata
    version=importlib.metadata.version('babeldoc')
    if version!=ENGINE_VERSION:raise RuntimeError('Expected BabelDOC '+ENGINE_VERSION+', found '+version)
    import pymupdf
    from bitstring import BitStream
    return {'ready':True,'engine':'BabelDOC','version':version,'python':sys.executable}

def export(config,job):
    configure_assets(config['assets'])
    from babeldoc.format.pdf.translation_config import TranslationConfig,WatermarkOutputMode
    from babeldoc.format.pdf.split_manager import PageCountStrategy
    from babeldoc.format.pdf.high_level import do_translate,get_translation_stage,init
    from babeldoc.progress_monitor import ProgressMonitor
    from babeldoc.translator.translator import BaseTranslator
    import babeldoc.format.pdf.high_level as pipeline
    import pymupdf
    bridge=FileBridge(job,config['cache'])
    original_layout_translator=pipeline.ILTranslator
    reference_state={'active':False,'pages':0}
    class BodyLayoutTranslator(original_layout_translator):
        def translate(self,docs):
            self.excluded=set()
            for page in docs.page:
                for paragraph in page.pdf_paragraph:
                    title=re.sub(r'\s+',' ',paragraph.unicode or '').strip()
                    if is_references_heading(title):reference_state['active']=True
                    elif re.match(r'^(?:appendix|appendices|supplementary material)\b',title,re.I):reference_state['active']=False
                    if reference_state['active'] or paragraph.layout_label in {'abandon','figure','table','table_footnote','isolate_formula','formula_caption'}:
                        self.excluded.add(id(paragraph))
            return super().translate(docs)
        def process_page(self,page,executor,pbar=None,tracker=None):
            self.translation_config.raise_if_cancelled()
            # PageCountStrategy resets page_number inside every split PDF.
            # Parts are processed sequentially, including pages with no text.
            reference_state['pages']+=1
            fonts={font.font_id:font for font in page.pdf_font}
            xfonts={x.xobj_id:{**fonts,**{font.font_id:font for font in x.pdf_font}} for x in page.pdf_xobject}
            prepared=[]
            for paragraph in page.pdf_paragraph:
                if id(paragraph) in self.excluded:
                    if pbar:pbar.advance()
                    continue
                row_tracker=tracker.new_paragraph()
                text,translate_input=self.pre_translate_paragraph(paragraph,row_tracker,fonts,xfonts)
                if text is None:
                    if pbar:pbar.advance()
                    continue
                row_tracker.new_llm_translate_tracker()
                prepared.append((paragraph,row_tracker,text,translate_input))
            if not prepared:return
            # Extract all eligible paragraphs first. One page becomes one web
            # request; the web adapter splits it only if the composer budget requires it.
            translated=bridge.translate_page([row[2] for row in prepared],reference_state['pages'])
            for (paragraph,row_tracker,text,translate_input),value in zip(prepared,translated):
                self.translation_config.raise_if_cancelled()
                self.post_translate_paragraph(paragraph,row_tracker,translate_input,value)
                if pbar:pbar.advance()
    # Keep excluded elements in the document IL so they render unchanged.
    pipeline.ILTranslator=BodyLayoutTranslator
    class WebTranslator(BaseTranslator):
        name='paper-gpt-web';model='ChatGPT-web'
        def __init__(self):super().__init__('en','zh',True)
        def do_translate(self,text,rate_limit_params=None):return bridge.translate(text)
        def do_llm_translate(self,text,rate_limit_params=None):raise NotImplementedError
    init()
    tc=TranslationConfig(translator=WebTranslator(),input_file=config['input'],lang_in='en',lang_out='zh',doc_layout_model=None,
        output_dir=str(job/'output'),working_dir=str(job/'working'),no_dual=True,no_mono=False,
        watermark_output_mode=WatermarkOutputMode.NoWatermark,qps=1,pool_max_workers=1,
        auto_extract_glossary=False,save_auto_extracted_glossary=False,use_rich_pbar=False,
        split_strategy=PageCountStrategy(1),report_interval=.5,min_text_length=5)
    def progress(**event):
        atomic_json(job/'progress.json',{'stage':event.get('stage',''),'percent':event.get('overall_progress',0),'completed':bridge.completed,'reused':bridge.reused})
    # Consume the synchronous result directly: the upstream async finish queue
    # can remain open after page-split merging even though the PDF is complete.
    with ProgressMonitor(get_translation_stage(tc),progress_change_callback=progress,report_interval=.5) as monitor:
        result=do_translate(monitor,tc)
    if bridge.failed or not result:raise RuntimeError('Translation incomplete; no PDF published')
    output=Path(result.no_watermark_mono_pdf_path or result.mono_pdf_path).resolve()
    if not output.is_relative_to((job/'output').resolve()) or not output.is_file():raise RuntimeError('Invalid output path')
    with pymupdf.open(config['input']) as source,pymupdf.open(output) as target:
        if source.page_count!=target.page_count:raise RuntimeError('Translated PDF page count changed')
        for a,b in zip(source,target):
            if any(abs(x-y)>.1 for x,y in zip(a.rect,b.rect)):raise RuntimeError('Translated PDF page dimensions changed')
        cjk=sum(len(re.findall(r'[\u3400-\u9fff]',page.get_text())) for page in target)
        if cjk<5 or bridge.completed+bridge.reused==0:raise RuntimeError('No usable Chinese translation found')
        return {'status':'complete','output':str(output),'pages':target.page_count,'translated':bridge.completed,'reused':bridge.reused,'webRequests':bridge.web_requests,'chineseCharacters':cjk,'engine':'BabelDOC '+ENGINE_VERSION}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--probe',action='store_true');parser.add_argument('--job',type=Path)
    args=parser.parse_args()
    if args.probe:
        try:print(json.dumps(probe()));return 0
        except Exception as e:print(json.dumps({'ready':False,'error':str(e)}));return 1
    job=args.job.resolve();config=json.loads((job/'config.json').read_text('utf8'))
    def watch_cancel():
        while True:
            if (job/'cancel.json').exists():os._exit(2)
            time.sleep(.15)
    threading.Thread(target=watch_cancel,daemon=True).start()
    logging.basicConfig(filename=str(job/'engine.log'),level=logging.INFO,encoding='utf8')
    try:
        probe()
        with (job/'engine-console.log').open('w',encoding='utf8') as log,contextlib.redirect_stdout(log),contextlib.redirect_stderr(log):
            if config.get('debugStackAfter'):
                import faulthandler
                faulthandler.dump_traceback_later(config['debugStackAfter'],file=log)
            result=export(config,job)
        atomic_json(job/'result.json',result);return 0
    except BaseException as e:
        logging.exception('PDF export failed');atomic_json(job/'result.json',{'status':'error','error':str(e)});return 1

if __name__=='__main__':sys.exit(main())
