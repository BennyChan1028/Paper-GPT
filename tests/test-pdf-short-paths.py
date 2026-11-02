from pathlib import Path
import importlib.util,tempfile,sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('worker',Path(__file__).resolve().parent.parent/'src'/'pdf-export-worker.py')
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
with tempfile.TemporaryDirectory(prefix='pg-long-name-test-') as directory:
    root=Path(directory);source=root/(('Long paper title 中文 '*7)+'.pdf');payload=b'%PDF-test-original-bytes'
    w.fs_path(source).write_bytes(payload);observed=[]
    def fake_backend(config,job,workspace,staged):
        observed.append(workspace)
        assert staged.name=='input.pdf' and staged.parent==workspace
        assert staged.read_bytes()==payload
        assert config['input']==str(source),'preserve original input identity for cache and publication'
        assert source.name not in str(staged)
        assert len(str(workspace/'w'/'input'/'input.zh.mono.cmap.pdf'))<260
        return {'status':'complete'}
    w.export_in_workspace=fake_backend
    assert w.export({'input':str(source)},root)['status']=='complete'
    assert not observed[0].exists(),'standalone worker removes its temporary rendering workspace'
    owned=root/'caller-owned';owned.mkdir()
    w.export({'input':str(source),'workspace':str(owned)},root)
    assert owned.exists(),'the caller owns cleanup of a supplied workspace'
    assert w.fs_path(source).read_bytes()==payload
    def failing_backend(config,job,workspace,staged):observed.append(workspace);raise RuntimeError('test render failure')
    w.export_in_workspace=failing_backend
    try:w.export({'input':str(source)},root)
    except RuntimeError as e:assert str(e)=='test render failure'
    else:raise AssertionError('expected failure')
    assert not observed[-1].exists(),'render failure removes temporary workspace'
    # This source deliberately exceeds MAX_PATH inside a Windows test host.
    w.fs_path(source).unlink()
print('PASS long Unicode source filenames, short native paths, exact source copy, stable cache identity and workspace ownership/cleanup')
