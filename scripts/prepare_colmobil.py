"""Extract logical PDF blocks with PyMuPDF, preserve 1-based PDF page citations.
Reproducible: pip install pymupdf; pnpm prepare:colmobil. No model/API calls.
Tables are extracted as text, not guaranteed structured; inspect original PDF.
"""
from pathlib import Path
import fitz, json, hashlib, re
root=Path(__file__).resolve().parents[1]
pdf=root/'corpus/colmobil/manual.pdf'
hash_=hashlib.sha256(pdf.read_bytes()).hexdigest()
chunks=[]; pages=[]
for number,page in enumerate(fitz.open(pdf),1):
    # Content-stream block order preserves the manual's RTL column flow better
    # than globally sorting lines across all three columns.
    blocks=[]
    for b in page.get_text('blocks',sort=False):
        if len(b)>6 and b[6]!=0: continue
        text=re.sub(r'[\u202a-\u202e\u2066-\u2069\x00-\x08\x0b\x0e-\x1f]','',b[4])
        text=re.sub(r'\s+',' ',text).strip()
        if len(text)>12: blocks.append(text)
    groups=[]; current=''
    for text in blocks:
        if len(current)+len(text)>2300 and current:
            groups.append(current); current=current[-220:]+'\n'+text
        else: current+='\n'+text
    if current.strip(): groups.append(current.strip())
    pages.append({'page':number,'chars':sum(map(len,blocks)),'chunks':len(groups)})
    for j,text in enumerate(groups):
        chunks.append({'chunkId':f'manual-p{number:03d}-{j+1}', 'text':text, 'metadata':{
          'documentId':f'colmobil/manual/page-{number}', 'relativePath':'corpus/colmobil/manual.pdf',
          'sourceHash':hash_, 'documentTitle':'יונדאי טוסון היברידי 2025 — ספר הרכב',
          'sectionPath':[f'עמוד PDF {number}'], 'sourceBlockIds':[f'page-{number}-group-{j+1}'],
          'pages':[number], 'warnings':['PDF text extraction: tables and fragmented words require visual verification'],
          'charCount':len(text),'tokenEstimate':round(len(text)/2.8),
          'tokenEstimateMethod':'heuristic_he_en_v1_max(words*1.3, chars/2.8)'}})
(root/'data/colmobil-chunks.json').write_text(json.dumps({'chunks':chunks},ensure_ascii=False))
(root/'data/colmobil-ingestion-report.json').write_text(json.dumps({'sourceSha256':hash_,'pages':pages,'chunkCount':len(chunks),'limitations':['Content-stream block order; PDF tables are not reconstructed.','Some words fragmented by the PDF producer.','Images and warning icons require original PDF inspection.']},ensure_ascii=False,indent=2))
print(f'{len(pages)} pages → {len(chunks)} chunks; {sum(p["chars"]<40 for p in pages)} low-text pages')
