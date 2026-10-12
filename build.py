from pathlib import Path
import argparse,json,zipfile
root=Path(__file__).resolve().parent/'src'
version=json.loads((root/'manifest.json').read_text(encoding='utf-8'))['version']
parser=argparse.ArgumentParser()
parser.add_argument('--output',type=Path,default=root.parent/f'Paper-GPT-{version}.xpi')
out=parser.parse_args().output.resolve()
out.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in sorted(root.rglob('*')):
        if p.is_file():
            info=zipfile.ZipInfo(p.relative_to(root).as_posix(),date_time=(2026,1,1,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=0o644 << 16
            z.writestr(info,p.read_bytes(),compresslevel=9)
print(out)
