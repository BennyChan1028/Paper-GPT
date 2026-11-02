"""Install the optional local PDF engine and register it for Zotero.

Run using Python 3.10-3.13. No account or translation API configuration is used.
"""
from pathlib import Path
import argparse,configparser,json,os,subprocess,sys,venv

def default_profile():
    if sys.platform=='win32':base=Path(os.environ['APPDATA'])/'Zotero'/'Zotero'
    elif sys.platform=='darwin':base=Path.home()/'Library'/'Application Support'/'Zotero'
    else:base=Path.home()/'.zotero'/'zotero'
    cp=configparser.ConfigParser();cp.read(base/'profiles.ini',encoding='utf8')
    profiles=[s for s in cp.sections() if s.startswith('Profile')]
    selected=[s for s in profiles if cp[s].get('Default')=='1']
    if not selected and len(profiles)==1:selected=profiles
    if len(selected)!=1:raise RuntimeError('无法确定 Zotero 配置目录，请通过 --profile 指定。')
    value=cp[selected[0]];path=Path(value['Path'])
    return base/path if value.get('IsRelative','1')=='1' else path

def main():
    if not (3,10)<=sys.version_info[:2]<(3,14):raise RuntimeError('请使用 Python 3.10–3.13（推荐 3.12）运行。')
    root=Path(__file__).resolve().parent
    parser=argparse.ArgumentParser();parser.add_argument('--profile',type=Path);parser.add_argument('--runtime',type=Path,default=root/'runtime'/'pdf-export');parser.add_argument('--assets',type=Path)
    args=parser.parse_args();profile=(args.profile or default_profile()).resolve()
    if not (profile/'prefs.js').is_file():raise RuntimeError('不是已存在的 Zotero 配置目录。')
    runtime=args.runtime.resolve();python=runtime/('Scripts/python.exe' if sys.platform=='win32' else 'bin/python')
    if not python.exists():venv.EnvBuilder(with_pip=True).create(runtime)
    subprocess.run([str(python),'-m','pip','install','--disable-pip-version-check','-r',str(root/'pdf-export-requirements.txt')],check=True)
    worker=root/'src'/'pdf-export-worker.py'
    status=json.loads(subprocess.check_output([str(python),str(worker),'--probe'],text=True))
    if not status.get('ready'):raise RuntimeError(str(status))
    assets=(args.assets or runtime.parent/'pdf-assets').resolve()
    target=profile/'paper-gpt-pdf-runtime.json';tmp=target.with_suffix('.tmp')
    tmp.write_text(json.dumps({'python':str(python),'assets':str(assets)},ensure_ascii=False,indent=2),'utf8');os.replace(tmp,target)
    print('PDF 导出组件已安装。回到 Zotero，选择“全文翻译为 PDF”即可。首次使用会下载版面模型与字体。')

if __name__=='__main__':
    try:main()
    except Exception as e:print('安装未完成：'+str(e));sys.exit(1)
