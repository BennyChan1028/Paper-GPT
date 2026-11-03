from pathlib import Path
import importlib.util,json,tempfile,threading,time,sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('worker',Path(__file__).resolve().parent.parent/'src'/'pdf-export-worker.py')
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
with tempfile.TemporaryDirectory(prefix='paper-gpt-page-bridge-') as directory:
    root=Path(directory);job=root/'job';job.mkdir();bridge=w.FileBridge(job,root/'cache')
    errors=[];values=[]
    def run(texts):
        try:values.append(bridge.translate_page(texts,2))
        except BaseException as e:errors.append(str(e))
    def request(excluded=set()):
        until=time.monotonic()+5
        while time.monotonic()<until:
            files=[p for p in bridge.queue.glob('*.request.json') if p not in excluded]
            if files:return files[0],json.loads(files[0].read_text('utf8'))
            time.sleep(.02)
        raise AssertionError('No page request')
    texts=['First paragraph <b1>formula</b1>.','Second paragraph.','Second paragraph.']
    t=threading.Thread(target=run,args=(texts,));t.start();path,r=request()
    assert len(r['items'])==2 and r['page']==2
    first=r['items'][0];w.atomic_json(path.with_name(r['id']+'.partial.json'),{'id':r['id'],'translations':[{'id':first['id'],'translation':'译文 '+first['text']}]})
    until=time.monotonic()+5
    while bridge.completed<1 and time.monotonic()<until:time.sleep(.02)
    assert bridge.completed==1
    w.atomic_json(path.with_name(r['id']+'.reply.json'),{'id':r['id'],'error':'webpage stopped'})
    t.join(5);assert not t.is_alive() and errors==['webpage stopped']
    t=threading.Thread(target=run,args=(texts,));t.start();path2,r2=request({path})
    assert len(r2['items'])==1 and r2['items'][0]['text']==texts[1],'resume sends only missing original paragraph'
    w.atomic_json(path2.with_name(r2['id']+'.reply.json'),{'id':r2['id'],'translations':[{'id':r2['items'][0]['id'],'translation':'第二段译文'}],'webRequests':1})
    t.join(5);assert not t.is_alive() and len(values)==1 and values[0][1:]==['第二段译文']*2
    assert bridge.translate_page(texts,2)==values[0] and bridge.web_requests==1
    invalid=['Changed <b3>placeholder</b3>.'];t=threading.Thread(target=run,args=(invalid,));t.start();path3,r3=request({path,path2})
    w.atomic_json(path3.with_name(r3['id']+'.reply.json'),{'id':r3['id'],'translations':[{'id':r3['items'][0]['id'],'translation':'遗漏占位符'}]})
    t.join(5);assert not t.is_alive() and 'placeholders changed' in errors[-1]
    assert not (bridge.cache/(bridge.key(invalid[0])+'.json')).exists()
    # Reusing a complete literal partition is safe after geometry joins two
    # previously separate paragraphs. Similar or reordered text is not reused.
    first='The robot combines the visual and tactile observations <b1>.'
    second='The combined model improves recognition in this experiment.'
    w.atomic_json(bridge.cache/(bridge.key(first)+'.json'),{'source':first,'translation':'机器人融合视觉与触觉观测<b1>。'})
    w.atomic_json(bridge.cache/(bridge.key(second)+'.json'),{'source':second,'translation':'融合模型提高了本实验中的识别表现。'})
    if hasattr(bridge,'cache_parts'):del bridge.cache_parts
    merged=first+' '+second
    assert bridge.compose_cached(merged)=='机器人融合视觉与触觉观测<b1>。融合模型提高了本实验中的识别表现。'
    assert bridge.compose_cached(second+' '+first+' Extra uncached material.') is None
    before=len(list(bridge.queue.glob('*.request.json')))
    assert bridge.translate_page([merged],3)==['机器人融合视觉与触觉观测<b1>。融合模型提高了本实验中的识别表现。']
    assert len(list(bridge.queue.glob('*.request.json')))==before
print('PASS page bridge deduplication, paragraph checkpoints, partial-page resume, old-cache reuse and formula validation')
