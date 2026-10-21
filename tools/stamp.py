#!/usr/bin/env python3
"""Carimba versão (hash do conteúdo) nos arquivos JS/CSS para o navegador nunca usar cópia velha.
Rode antes de cada commit:  python3 tools/stamp.py"""
import hashlib, json, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
html_path = root / 'index.html'
html = html_path.read_text()
h = lambda p: hashlib.sha1(p.read_bytes()).hexdigest()[:8]

js_dirs = [d for d in ('src', 'assets') if (root / d).is_dir()]
files = sorted(p for d in js_dirs for p in (root / d).rglob('*.js'))
imports = {f'./{p.relative_to(root).as_posix()}': f'./{p.relative_to(root).as_posix()}?v={h(p)}' for p in files}
block = '<script type="importmap">' + json.dumps({'imports': imports}, ensure_ascii=False) + '</script>'

html = re.sub(r'\s*<script type="importmap">.*?</script>', '', html, flags=re.S)
# importmap precisa vir antes do primeiro <script type="module">
html = re.sub(r'(\s*)(<script type="module")', lambda m: f'{m.group(1)}{block}{m.group(1)}{m.group(2)}', html, count=1)
for css in [p for p in root.glob('**/*.css') if '.git' not in p.parts]:
    rel = css.relative_to(root).as_posix()
    html = re.sub(rf'href="{re.escape(rel)}(\?v=[0-9a-f]+)?"', f'href="{rel}?v={h(css)}"', html)
for p in files:
    rel = p.relative_to(root).as_posix()
    html = re.sub(rf'src="{re.escape(rel)}(\?v=[0-9a-f]+)?"', f'src="{rel}?v={h(p)}"', html)
html_path.write_text(html)
print(f'{len(files)} arquivos carimbados')
