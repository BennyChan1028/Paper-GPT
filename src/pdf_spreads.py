"""Pair original and translated PDF pages without rasterizing their contents."""
from pathlib import Path
import pymupdf


def side_by_side(original, translated, output):
    output = Path(output)
    if output.exists():
        raise RuntimeError('Bilingual output already exists')
    with pymupdf.open(original) as source, pymupdf.open(translated) as mono, pymupdf.open() as dual:
        if source.page_count == 0 or source.page_count != mono.page_count:
            raise RuntimeError('Bilingual page count does not match the original')
        dimensions = []
        for index in range(source.page_count):
            left, right = source[index], mono[index]
            if any(abs(a-b) > .1 for a, b in zip(left.rect, right.rect)):
                raise RuntimeError('Bilingual page dimensions do not match the original')
            # show_pdf_page uses unrotated source coordinates. Normalize the
            # in-memory pages while retaining their visible orientation.
            left.remove_rotation()
            right.remove_rotation()
            w, h = left.rect.width, left.rect.height
            if w <= 0 or h <= 0:
                raise RuntimeError('Invalid bilingual page dimensions')
            page = dual.new_page(width=w*2, height=h)
            if left.get_contents():
                page.show_pdf_page(pymupdf.Rect(0, 0, w, h), source, index)
            if right.get_contents():
                page.show_pdf_page(pymupdf.Rect(w, 0, w*2, h), mono, index)
            dimensions.append((w*2, h))
        toc = source.get_toc()
        if toc:
            dual.set_toc(toc)
        dual.set_metadata({'title': '中英双语对照', 'subject': '左：英文原文；右：中文译文', 'creator': 'Paper GPT'})
        dual.save(output, garbage=3, deflate=True)
    with pymupdf.open(output) as verified:
        if verified.page_count != len(dimensions):
            raise RuntimeError('Invalid saved bilingual page count')
        for page, (w, h) in zip(verified, dimensions):
            if abs(page.rect.width-w) > .1 or abs(page.rect.height-h) > .1:
                raise RuntimeError('Invalid saved bilingual page size')
    return len(dimensions)
