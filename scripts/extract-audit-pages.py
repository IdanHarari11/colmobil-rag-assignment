"""Extract QA reference text directly from the original PDF, not the retrieval chunks."""
import json
import hashlib
import pathlib
import sys
import fitz
source = pathlib.Path('corpus/colmobil/manual.pdf')
target = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'data/qa-original-pages.json')
with fitz.open(source) as pdf:
    pages = {str(i + 1): page.get_text(sort=False) for i, page in enumerate(pdf)}
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps({'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'pages': pages}, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'pages': len(pages), 'output': str(target)}))
