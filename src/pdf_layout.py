"""Fixed-region typesetting policy for the pinned, local BabelDOC adapter."""
import copy,math,os,statistics,struct
from pathlib import Path

class TrueTypeBounds:
    """Read actual per-glyph ink bounds, rather than a whole-font fallback box."""
    def __init__(self,path):
        self.data=Path(path).read_bytes();d=self.data
        count=struct.unpack_from('>H',d,4)[0]
        tables={d[12+i*16:16+i*16].decode('ascii'):struct.unpack_from('>II',d,20+i*16) for i in range(count)}
        head=tables['head'][0];self.em=struct.unpack_from('>H',d,head+18)[0]
        self.long=struct.unpack_from('>h',d,head+50)[0];self.loca=tables['loca'][0];self.glyf=tables['glyf'][0]
    def get(self,glyph):
        d=self.data
        if self.long:begin,end=struct.unpack_from('>II',d,self.loca+glyph*4)
        else:begin,end=(x*2 for x in struct.unpack_from('>HH',d,self.loca+glyph*2))
        if begin==end:return (0.,0.,0.,0.)
        return tuple(x/self.em for x in struct.unpack_from('>hhhh',d,self.glyf+begin+2))

def bounds(box):return (box.x,box.y,box.x2,box.y2)
def inside(inner,outer,tolerance=.08):
    return all(math.isfinite(v) for v in inner) and inner[0]>=outer[0]-tolerance and inner[1]>=outer[1]-tolerance and inner[2]<=outer[2]+tolerance and inner[3]<=outer[3]+tolerance
def overlaps(a,b):return a[0]<b[2] and a[2]>b[0] and a[1]<b[3] and a[3]>b[1]

class PageLayoutIndex:
    """Small page-local index; avoids libspatialindex pointer faults on Windows."""
    def __init__(self,entries):self.entries=tuple(entries)
    def intersection(self,query):
        if not all(math.isfinite(v) for v in query):raise RuntimeError('PDF 含有无效页面坐标，无法可靠排版。')
        return (i for i,b in self.entries if b[0]<=query[2] and b[2]>=query[0] and b[1]<=query[3] and b[3]>=query[1])
def stable_layout_index(page):
    mapping={i:layout for i,layout in enumerate(page.page_layout)}
    entries=[]
    for i,layout in mapping.items():
        if layout.box:
            b=bounds(layout.box)
            if not all(math.isfinite(v) for v in b):raise RuntimeError('PDF 含有无效版面坐标。')
            entries.append((i,b))
    return PageLayoutIndex(entries),mapping

def largest_fit(trial,maximum=1.,minimum=.04):
    """Return a successful complete layout; never return a partial last trial."""
    upper=min(1.,maximum)
    result=trial(upper)
    if result is not None:return upper,result
    lower=upper/2
    while lower>=minimum:
        result=trial(lower)
        if result is not None:break
        upper=lower;lower/=2
    else:
        lower=minimum;result=trial(lower)
        if result is None:raise RuntimeError('PDF 区域过小，无法完整排入译文；未发布裁切的 PDF。')
    best=result
    for _ in range(14):
        middle=(lower+upper)/2;result=trial(middle)
        if result is None:upper=middle
        else:lower=middle;best=result
    return lower,best

def table_regions(page):
    """Expand ink bounds only into the same table column's free whitespace."""
    groups=[]
    for frame in page.page_layout:
        if frame.class_name!='table' or not frame.box:continue
        f=bounds(frame.box);members=[]
        for p in page.pdf_paragraph:
            if not p.box or p.layout_label in {'abandon','table_caption'}:continue
            b=bounds(p.box);cx=(b[0]+b[2])/2;cy=(b[1]+b[3])/2
            if f[0]<=cx<=f[2] and f[1]<=cy<=f[3]:members.append(p)
        if len(members)<2:continue
        intervals=sorted((p.box.x,p.box.x2) for p in members if p.box.x2-p.box.x<.65*(f[2]-f[0]))
        union=[]
        for left,right in intervals:
            if union and left<=union[-1][1]:union[-1][1]=max(union[-1][1],right)
            else:union.append([left,right])
        edges=[f[0]]+[(a[1]+b[0])/2 for a,b in zip(union,union[1:]) if b[0]-a[1]>=max(5.,.015*(f[2]-f[0]))]+[f[2]]
        regions={}
        for p in members:
            b=bounds(p.box);left=max((x for x in edges[:-1] if x<=b[0]+1),default=f[0])+2
            right=min((x for x in edges[1:] if x>=b[2]-1),default=f[2])-2
            # Separate fragments sharing a source line must never be overlaid.
            for other in members:
                if other is p:continue
                q=bounds(other.box);vertical=min(b[3],q[3])-max(b[1],q[1])
                if vertical<.45*min(b[3]-b[1],q[3]-q[1]):continue
                if q[2]<=b[0]+.1:left=max(left,(q[2]+b[0])/2)
                if q[0]>=b[2]-.1:right=min(right,(b[2]+q[0])/2)
            regions[id(p)]=(min(left,b[0]),b[1],max(right,b[2]),b[3])
        groups.append((members,regions))
    return groups

def install(pipeline,report):
    from babeldoc.format.pdf.document_il.il_version_1 import Box,PdfParagraphComposition
    from babeldoc.format.pdf.document_il.midend.typesetting import TypesettingUnit
    if os.name=='nt':
        from babeldoc.format.pdf.document_il.midend import paragraph_finder,styles_and_formulas
        paragraph_finder.build_layout_index=stable_layout_index
        styles_and_formulas.build_layout_index=stable_layout_index
    parent=getattr(pipeline.Typesetting,'_paper_gpt_original',pipeline.Typesetting)
    serial=[0];font_bounds={};glyphs={}
    class FixedRegionTypesetting(parent):
        _paper_gpt_original=parent
        def __init__(self,config):
            super().__init__(config);self.table_sizes={};self.regions={};self.table_ids={};self.table_original=set();self.glyphs=glyphs;self.font_bounds=font_bounds
        def fonts_for(self,page):
            fonts={f.font_id:f for f in page.pdf_font if f.font_id};original=fonts.copy()
            fonts.update(self.font_mapper.fontid2font)
            for x in page.pdf_xobject:
                if x.xobj_id is not None:fonts[x.xobj_id]={**original,**{f.font_id:f for f in x.pdf_font if f.font_id}}
            return fonts
        def create_typesetting_units(self,p,fonts):
            units=super().create_typesetting_units(p,fonts)
            for u in units:
                if u.formular and not u.font_size:
                    sizes=[c.pdf_style.font_size for c in u.formular.pdf_character if c.pdf_style and c.pdf_style.font_size]
                    u.font_size=statistics.mode(sizes) if sizes else 12.
            if id(p) in self.table_sizes:
                size=self.table_sizes[id(p)];normalized=[]
                for u in units:
                    if u.unicode:
                        u.font_size=size;u.box_cache=None;u.width_cache=None;u.height_cache=None
                    elif u.char and u.char.char_unicode:
                        char=u.char;source=fonts.get(char.pdf_style.font_id)
                        if char.xobj_id in fonts and isinstance(fonts[char.xobj_id],dict):source=fonts[char.xobj_id].get(char.pdf_style.font_id,source)
                        for c in char.char_unicode:
                            font=self.font_mapper.map(source,c) if source is not None else self.font_mapper.base_font
                            xobj=char.xobj_id if char.xobj_id is not None else p.xobj_id if p.xobj_id is not None else -1
                            normalized.append(TypesettingUnit(unicode=c,font=font,original_font=source,font_size=size,style=char.pdf_style,xobj_id=xobj))
                        continue
                    normalized.append(u)
                units=normalized
            return units
        def glyph(self,u):
            key=(str(getattr(u.font,'font_path',None) or u.font.name),u.unicode)
            if key not in self.glyphs:
                path=getattr(u.font,'font_path',None)
                if path not in self.font_bounds:
                    try:self.font_bounds[path]=TrueTypeBounds(path) if path else None
                    except (KeyError,OSError,ValueError,struct.error):self.font_bounds[path]=None
                reader=self.font_bounds[path]
                self.glyphs[key]=reader.get(u.font.has_glyph(ord(u.unicode))) if reader else tuple(u.font.glyph_bbox(ord(u.unicode)))
            return self.glyphs[key]
        def ink(self,u):
            if u.unicode and u.font:
                g=self.glyph(u);s=u.font_size
                return (u.x+g[0]*s,u.y+g[1]*s,u.x+g[2]*s,u.y+g[3]*s)
            return bounds(u.box)
        def fit(self,p,units,maximum=1.):
            outer=self.regions.get(id(p),bounds(p.box));expected=sum(not u.is_space for u in units)
            over=[0.,0.,0.,0.]
            for u in units:
                if u.unicode and u.font:
                    g=self.glyph(u);s=u.font_size
                    over=[max(over[0],-g[0]*s),max(over[1],-g[1]*s),max(over[2],g[2]*s-u.width),max(over[3],g[3]*s-u.height)]
            heights=[u.height for u in units]
            if heights:over[3]+=max(0.,max(heights)-statistics.mode(heights))
            def trial(scale,word_break=None):
                if word_break is None:word_break=id(p) not in self.table_ids
                pad=.12
                box=Box(x=outer[0]+over[0]*scale+pad,y=outer[1]+over[1]*scale+pad,x2=outer[2]-over[2]*scale-pad,y2=outer[3]-over[3]*scale-pad)
                if box.x2<=box.x or box.y2<=box.y:return None
                placed,complete=self._layout_typesetting_units(units,box,scale,1.2 if id(p) in self.table_ids else 1.3,p,word_break)
                if not complete or sum(not u.is_space for u in placed)!=expected:return None
                if not all(inside(self.ink(u),outer) for u in placed if not u.is_space):return None
                return placed
            try:return largest_fit(trial,maximum)
            except RuntimeError:return largest_fit(lambda s:trial(s,False),maximum)
        def preprocess_document(self,document,pbar):
            for page in document.page:
                pbar.advance();fonts=self.fonts_for(page);groups=table_regions(page)
                for index,(members,regions) in enumerate(groups):
                    sizes=[]
                    for p in members:
                        raw=super().create_typesetting_units(p,fonts)
                        if raw and all(u.can_passthrough for u in raw):self.table_original.add(id(p))
                        for u in raw:
                            if u.font_size:sizes.append(round(u.font_size,3))
                            elif u.char and u.char.pdf_style.font_size:sizes.append(round(u.char.pdf_style.font_size,3))
                    size=statistics.mode(sizes) if sizes else 12.
                    for p in members:
                        self.table_sizes[id(p)]=size;self.table_ids[id(p)]=index;self.regions[id(p)]=regions[id(p)];p.first_line_indent=False
                for p in page.pdf_paragraph:
                    units=self.create_typesetting_units(p,fonts)
                    if units and (id(p) in self.table_ids or not all(u.can_passthrough for u in units)):
                        p.optimal_scale=self.fit(p,units)[0]
                for members,_ in groups:
                    scale=min(p.optimal_scale or 1. for p in members)
                    for p in members:p.optimal_scale=scale
        def render_page(self,page):
            # Preserve the original fixed boxes; the upstream neighbour-space
            # adjustment changes them after the font-fitting prepass.
            serial[0]+=1;self.report_page=serial[0];fonts=self.fonts_for(page)
            for p in page.pdf_paragraph:self.render_paragraph(p,page,fonts)
        def render_paragraph(self,p,page,fonts):
            units=self.create_typesetting_units(p,fonts)
            original_units=super().create_typesetting_units(p,fonts) if id(p) in self.table_original else None
            if not units or not p.box or id(p) not in self.table_ids and all(u.can_passthrough for u in units):
                return super().render_paragraph(p,page,fonts)
            scale,placed=self.fit(p,units,p.optimal_scale or 1.)
            outer=self.regions.get(id(p),bounds(p.box))
            # Word-generated manuscripts paint a separate background per source
            # line. A reflowed paragraph must be above every overlapping fill.
            order=getattr(p,'render_order',None) or 0
            for curve in page.pdf_curve:
                if curve.fill_background and curve.box and overlaps(bounds(curve.box),outer):order=max(order,(getattr(curve,'render_order',None) or 0)+1)
            p.render_order=order;p.scale=scale;p.pdf_paragraph_composition=[]
            if id(p) in self.table_original:
                # Untranslated numeric rows may span several physical cells.
                # Keep their source cell positions instead of reflowing values
                # from different columns into one continuous string.
                raw=original_units;sizes=[]
                for u in raw:
                    if u.char:sizes.append(u.char.pdf_style.font_size)
                    elif u.formular:sizes.extend(c.pdf_style.font_size for c in u.formular.pdf_character if c.pdf_style)
                sizes=[s for s in sizes if s and s>0]
                factor=self.table_sizes[id(p)]*scale/(statistics.mode(sizes) if sizes else self.table_sizes[id(p)])
                runs=[]
                for u in raw:
                    previous=runs[-1][-1] if runs else None
                    split=previous is None or u.formular or previous.formular
                    if previous is not None and u.char and previous.char:
                        split=abs(u.char.box.y-previous.char.box.y)>max(u.height,previous.height)*.7 or u.box.x<previous.box.x or u.box.x-previous.box.x2>max(self.table_sizes[id(p)]*.6,4)
                    if split:runs.append([])
                    runs[-1].append(u)
                for run in runs:
                    cx=(min(u.box.x for u in run)+max(u.box.x2 for u in run))/2
                    cy=(min(u.box.y for u in run)+max(u.box.y2 for u in run))/2
                    def transform(b):return Box(x=cx+(b.x-cx)*factor,y=cy+(b.y-cy)*factor,x2=cx+(b.x2-cx)*factor,y2=cy+(b.y2-cy)*factor)
                    for u in run:
                        if u.char:
                            char=copy.deepcopy(u.char);char.box=transform(char.box)
                            if char.visual_bbox and char.visual_bbox.box:char.visual_bbox.box=transform(char.visual_bbox.box)
                            ink_box=char.visual_bbox.box if char.visual_bbox and char.visual_bbox.box else char.box
                            if not inside(bounds(ink_box),outer):raise RuntimeError('表格原有数值超出单元格边界，未发布 PDF。')
                            char.pdf_style.font_size*=factor
                            if char.advance:char.advance*=factor
                            p.pdf_paragraph_composition.append(PdfParagraphComposition(pdf_character=char))
                        else:
                            shifted=u.relocate(cx+(u.box.x-cx)*factor,cy+(u.box.y-cy)*factor,factor)
                            if not inside(bounds(shifted.formular.box),outer):raise RuntimeError('表格公式超出单元格边界，未发布 PDF。')
                            p.pdf_paragraph_composition.append(PdfParagraphComposition(pdf_formula=shifted.formular))
            else:
                for u in placed:
                    chars,curves,forms=u.render()
                    for char in chars:p.pdf_paragraph_composition.append(PdfParagraphComposition(pdf_character=char))
                    page.pdf_curve.extend(curves);page.pdf_form.extend(forms)
            self._update_paragraph_render_order(p)
            report.append({'page':self.report_page,'table':self.table_ids.get(id(p)),'box':list(outer),'scale':scale,'fontSize':self.table_sizes.get(id(p),0)*scale if id(p) in self.table_ids else None,'complete':True,'units':sum(not u.is_space for u in placed),'backgroundOrder':order})
    pipeline.Typesetting=FixedRegionTypesetting
