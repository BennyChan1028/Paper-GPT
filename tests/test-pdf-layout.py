from pathlib import Path
from types import SimpleNamespace as NS
import importlib.util,struct,sys,tempfile
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('layout',Path(__file__).resolve().parent.parent/'src'/'pdf_layout.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
scale,result=m.largest_fit(lambda s:('all characters',s) if s<=.637 else None)
assert .6369<scale<=.637 and result[1]==scale
assert m.largest_fit(lambda s:['complete'],maximum=.8)[0]==.8
try:m.largest_fit(lambda s:None)
except RuntimeError as e:assert '未发布裁切' in str(e)
else:raise AssertionError('An impossible layout must not return a partial result')
assert m.inside((1,1,9,9),(0,0,10,10)) and not m.inside((1,1,11,9),(0,0,10,10))
assert not m.inside((float('nan'),1,2,3),(0,0,10,10))
index=m.PageLayoutIndex([(0,(0,0,10,10)),(1,(20,20,30,30))])
assert list(index.intersection((10,10,20,20)))==[0,1],'touching bounds use the same inclusive intersection as the native index'
assert list(index.intersection((40,40,50,50)))==[]
try:list(index.intersection((float('nan'),0,1,1)))
except RuntimeError:pass
else:raise AssertionError('invalid coordinates must not silently lose text')
box=lambda a:NS(x=a[0],y=a[1],x2=a[2],y2=a[3])
para=lambda a:NS(box=box(a),layout_label='fallback_line')
parts=[para((10,70,35,80)),para((60,70,92,80)),para((110,70,195,80)),para((110,40,140,50)),para((160,40,195,50))]
caption=NS(box=box((0,101,200,112)),layout_label='table_caption')
groups=m.table_regions(NS(page_layout=[NS(class_name='table',box=box((0,0,200,100)))],pdf_paragraph=parts+[caption]))
assert len(groups)==1 and len(groups[0][0])==5
regions=groups[0][1];assert regions[id(parts[3])][2]<=regions[id(parts[4])][0],'same-line fragments cannot overlap after table normalization'
assert id(caption) not in regions
# A minimal TrueType fixture: two glyphs, one empty and one with a real bbox.
with tempfile.TemporaryDirectory(prefix='pg-font-bounds-') as directory:
    data=bytearray(160);struct.pack_into('>IH',data,0,0x10000,3)
    for i,(tag,offset,length) in enumerate([(b'head',64,54),(b'loca',120,6),(b'glyf',128,10)]):
        struct.pack_into('>4sIII',data,12+i*16,tag,0,offset,length)
    struct.pack_into('>H',data,82,1000);struct.pack_into('>h',data,114,0)
    struct.pack_into('>HHH',data,120,0,0,5);struct.pack_into('>hhhhh',data,128,1,20,-50,980,850)
    path=Path(directory)/'font.ttf';path.write_bytes(data);reader=m.TrueTypeBounds(path)
    assert reader.get(0)==(0.,0.,0.,0.) and reader.get(1)==(.02,-.05,.98,.85)
print('PASS largest complete fit, impossible-fit failure, real glyph bounds, table column confinement and same-line fragment separation')
