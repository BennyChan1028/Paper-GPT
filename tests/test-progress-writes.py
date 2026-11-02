from pathlib import Path
import importlib.util,json,tempfile,threading,time,sys,os
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('worker',Path(__file__).resolve().parent.parent/'src'/'pdf-export-worker.py')
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
with tempfile.TemporaryDirectory(prefix='paper-gpt-progress-test-') as directory:
    path=Path(directory)/'progress.json';w.atomic_json(path,{'old':True})
    if os.name=='nt':
        import ctypes
        from ctypes import wintypes
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.CreateFileW.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE]
        kernel.CreateFileW.restype=wintypes.HANDLE
        kernel.CloseHandle.argtypes=[wintypes.HANDLE];kernel.CloseHandle.restype=wintypes.BOOL
        def lock():
            handle=kernel.CreateFileW(str(path),0x80000000,3,None,3,0,None)
            assert handle not in (None,ctypes.c_void_p(-1).value),ctypes.get_last_error()
            return handle
        h=lock();probe=path.with_name('probe.tmp');probe.write_text('{}','utf8')
        try:
            try:os.replace(probe,path)
            except PermissionError:pass
            else:raise AssertionError('Windows lock did not reproduce original failure')
        finally:probe.unlink(missing_ok=True)
        timer=threading.Timer(.08,lambda:kernel.CloseHandle(h));timer.start()
        w.atomic_json(path,{'retried':True});timer.join();assert json.loads(path.read_text('utf8'))=={'retried':True}
        h=lock();reporter=w.ProgressWriter(path,lambda:{'completed':7,'reused':2},interval=0)
        try:reporter(stage='Translate Paragraphs',overall_progress=50)
        finally:kernel.CloseHandle(h)
        assert reporter.warned and json.loads(path.read_text('utf8'))=={'retried':True}
        assert list(Path(directory).glob('*.tmp'))==[],'failed writes clean only their own temporary files'
        reporter(stage='Save PDF',overall_progress=99);assert json.loads(path.read_text('utf8'))['completed']==7
    atomic=w.atomic_json;calls=[]
    try:
        w.atomic_json=lambda *args:calls.append(args)
        reporter=w.ProgressWriter(path,lambda:{},interval=60)
        for _ in range(100):reporter(stage='Translate Paragraphs',overall_progress=1)
        assert len(calls)==1,'frequent progress events are coalesced'
        entered=threading.Event();release=threading.Event();calls.clear()
        def blocked(*args):calls.append(args);entered.set();assert release.wait(2)
        w.atomic_json=blocked;reporter=w.ProgressWriter(path,lambda:{},interval=0)
        t=threading.Thread(target=lambda:reporter(stage='Parse PDF'));t.start();assert entered.wait(1)
        reporter(stage='Translate Paragraphs');release.set();t.join();assert len(calls)==1,'concurrent callbacks cannot race to replace progress'
        def denied(*args):raise PermissionError('persistent denial')
        w.atomic_json=denied
        try:atomic(Path(directory)/'cache.json',{'required':True})
        except OSError:raise AssertionError('unlocked required writes should succeed')
        reporter=w.ProgressWriter(path,lambda:{},interval=0);reporter();assert reporter.warned
    finally:w.atomic_json=atomic
print('PASS real Windows sharing-denial reproduction, retry, nonfatal progress, old-file preservation, temp cleanup, throttling and concurrent callbacks')
