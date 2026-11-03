from pathlib import Path
import importlib.util,tempfile,hashlib,sys
import pymupdf
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('spreads',Path(__file__).resolve().parent.parent/'src'/'pdf_spreads.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='pg-spreads-') as directory:
    root=Path(directory);a=root/'source.pdf';b=root/'translated.pdf';out=root/'bilingual.pdf'
    for dest,chinese in [(a,False),(b,True)]:
        with pymupdf.open() as doc:
            for i in range(4):
                p=doc.new_page(width=400 if i!=2 else 600,height=600 if i!=2 else 400)
                if i<3:
                    p.insert_text((55,95),('中文对照测试' if chinese else 'Original English')+str(i),fontname='china-s' if chinese else 'helv',fontsize=14)
                    p.draw_rect((60,120,250,180),color=(0,0,1),width=2)
                    pix=pymupdf.Pixmap(pymupdf.csRGB,pymupdf.IRect(0,0,10,10),False);pix.set_rect(pix.irect,(200,30,50))
                    p.insert_image((60,210,100,250),stream=pix.tobytes('png'))
                if i==1:p.set_rotation(90)
                if i==2:p.set_cropbox(pymupdf.Rect(30,40,560,360))
            doc.set_toc([[1,'First section',1],[1,'Rotated section',2]])
            doc.save(dest)
    hashes=[hashlib.sha256(p.read_bytes()).hexdigest() for p in [a,b]]
    assert module.side_by_side(a,b,out)==4
    assert hashes==[hashlib.sha256(p.read_bytes()).hexdigest() for p in [a,b]],'source PDFs must not be edited'
    with pymupdf.open(a) as original,pymupdf.open(b) as translated,pymupdf.open(out) as paired:
        assert paired.page_count==original.page_count and paired.get_toc()==original.get_toc()
        for i,(left,right,page) in enumerate(zip(original,translated,paired)):
            w,h=left.rect.width,left.rect.height
            assert page.rect==pymupdf.Rect(0,0,w*2,h)
            for source,clip in [(left,pymupdf.Rect(0,0,w,h)),(right,pymupdf.Rect(w,0,w*2,h))]:
                expected=source.get_pixmap();actual=page.get_pixmap(clip=clip)
                assert expected.width==actual.width and expected.height==actual.height
                assert expected.samples==actual.samples,('original display must be identical',i)
        assert 'Original English0' in paired[0].get_text(clip=pymupdf.Rect(0,0,400,600))
        assert '中文对照测试0' in paired[0].get_text(clip=pymupdf.Rect(400,0,800,600))
        assert len(paired[0].get_images())>=1,'figures remain embedded'
    try:module.side_by_side(a,b,out)
    except RuntimeError as e:assert 'already exists' in str(e)
    else:raise AssertionError('must not overwrite an existing output')
    with pymupdf.open() as doc:doc.new_page();doc.save(root/'mismatch.pdf')
    try:module.side_by_side(a,root/'mismatch.pdf',root/'bad.pdf')
    except RuntimeError as e:assert 'page count' in str(e)
    else:raise AssertionError('mismatched page counts must fail')
    assert not (root/'bad.pdf').exists()
print('PASS side-by-side page order, searchable Chinese/English, exact left/right rendered pixels, rotation, crop, mixed dimensions, blank pages, figures, bookmarks, source hashes and invalid-output guards')
