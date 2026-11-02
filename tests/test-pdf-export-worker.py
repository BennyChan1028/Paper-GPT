from pathlib import Path
import importlib.util,json,os,sys,tempfile
sys.dont_write_bytecode=True
source=Path(__file__).resolve().parent.parent/'src'/'pdf-export-worker.py'
spec=importlib.util.spec_from_file_location('worker',source);worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
for text in ['References','REFERENCES','VII. REFERENCES','8. Bibliography','Literature Cited','参考文献','References and Notes']:
    assert worker.is_references_heading(text),text
for text in ['We compare references in this section.','Reference frames are aligned','Introduction']:
    assert not worker.is_references_heading(text),text
with tempfile.TemporaryDirectory(prefix='paper-gpt-export-test-') as directory:
    root=Path(directory).resolve()
    assert root.is_relative_to(Path(tempfile.gettempdir()).resolve())
    cache=root
    while len(str(cache))<195:cache=cache/('deep-directory-'+'x'*13)
    target=cache/('f'*64+'.json')
    worker.atomic_json(target,{'ready':True})
    assert json.loads(worker.fs_path(target).read_text('utf8'))['ready']
    worker.fs_path(target).unlink()
print('PASS reference heading variants, false-positive guard and long Windows cache paths')
