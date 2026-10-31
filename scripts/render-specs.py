#!/usr/bin/env python3
"""Render canonical Markdown specifications as a local, self-contained reader."""
from pathlib import Path
import html
import re
import markdown

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
PAGES = [
    ("design", "Product design", "specs/0002-product-design.md"),
    ("contracts", "API contracts", "specs/0003-dashboard-api.md"),
    ("plan", "Implementation", "plans/0001-dashboard-implementation.md"),
    ("audit", "Contract audit", "research/2026-10-31-contract-audit.md"),
]
STYLE = """
:root{color-scheme:dark;--bg:#111418;--panel:#191f26;--text:#eef1f5;--muted:#b6c1ce;--accent:#b1b2ff;--border:#36414f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 system-ui,sans-serif}
main{max-width:1200px;margin:auto;padding:36px 28px 80px}h1{font-size:34px;line-height:1.2}h2{margin-top:40px;font-size:26px}h3{font-size:20px}
p,li{max-width:100ch}a{color:var(--accent);text-underline-offset:3px}a:focus-visible{outline:3px solid #f3c576;outline-offset:4px}
nav{display:flex;flex-wrap:wrap;gap:12px 24px;padding:18px 24px;background:var(--panel);border-bottom:1px solid var(--border)}
.intro{padding:20px 24px;background:var(--panel);border:1px solid var(--border);border-radius:12px}.muted{color:var(--muted)}
section{margin-top:50px;padding-top:12px;border-top:1px solid var(--border);scroll-margin-top:20px}.source{font-size:14px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:12px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}th{color:var(--accent);background:var(--panel)}
.table-wrap{overflow:auto;margin:24px 0}code{font-size:.9em;background:var(--panel);padding:2px 4px;overflow-wrap:anywhere}pre{padding:20px;background:var(--panel);overflow:auto}pre code{padding:0}
li{margin:8px 0}figure{margin:28px 0}img{max-width:100%;height:auto;border:1px solid var(--border);border-radius:10px}figcaption{color:var(--muted);margin-top:8px}
@media(max-width:700px){main{padding:24px 16px}h1{font-size:28px}h2{font-size:23px}nav{padding:16px}th,td{min-width:140px}}
@media print{:root{color-scheme:light}body{background:white;color:#111}nav{display:none}a{color:#334}.intro,th,pre,code{background:#f2f3f6}section{break-before:page}main{max-width:none;padding:0}}
"""

def document(title, nav, body):
    return f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title><style>{STYLE}</style></head><body>{nav}<main>{body}</main></body></html>\n'

def rebase_links(rendered, origin):
    def replace(match):
        attr, value = match.groups()
        if value.startswith(("#", "http:", "https:", "mailto:")):
            return match.group(0)
        path, marker, fragment = value.partition("#")
        target = (origin.parent / path).resolve()
        for ident, _, relative in PAGES:
            if target == (DOCS / relative).resolve() and not marker:
                return f'{attr}="#{ident}"'
        import os
        relative = os.path.relpath(target, DOCS)
        return f'{attr}="{html.escape(relative, quote=True)}{marker}{fragment}"'
    return re.sub(r'(href|src)="([^"]+)"', replace, rendered)

nav = '<nav aria-label="Specification sections">' + ''.join(f'<a href="#{i}">{label}</a>' for i, label, _ in PAGES) + '<a href="design/index.html">Mockup gallery</a></nav>'
parts = ['<h1>Agent Q dashboard specification</h1><div class="intro"><p><strong>Contract readiness: partial.</strong> Existing human APIs provide a strong foundation. The complete dashboard API, provider quota, global conversation integration and Results/comment/feedback contracts still need publication and implementation.</p><p class="muted">October 31, 2026 · Proposed implementation specification based on the accepted visual direction. Markdown source documents are canonical. This reader is documentation, not the dashboard application.</p></div>']
for ident, label, relative in PAGES:
    source = DOCS / relative
    rendered = markdown.markdown(source.read_text(), extensions=["tables", "fenced_code"])
    rendered = rebase_links(rendered, source).replace('<table>', '<div class="table-wrap"><table>').replace('</table>', '</table></div>')
    parts.append(f'<section id="{ident}"><p class="source"><a href="{relative}">Canonical Markdown</a> · <a href="#">Back to top</a></p>{rendered}</section>')
(DOCS / 'index.html').write_text(document('Agent Q dashboard specification', nav, ''.join(parts)))

import json
manifest = json.loads((DOCS / 'design/manifest.json').read_text())
figures = ['<h1>Dashboard design references</h1><p>Twelve selected concepts. Sample data and static video previews; behavior is governed by the <a href="../index.html">product specification</a>. The focused Agents design replaces the earlier tiled default.</p>']
for asset in manifest['assets']:
    name, title = html.escape(asset['file']), html.escape(asset['title'])
    figures.append(f'<figure><h2>{title}</h2><a href="{name}"><img src="{name}" alt="{title} concept mockup" loading="lazy"></a><figcaption>{name}</figcaption></figure>')
(DOCS / 'design/index.html').write_text(document('Agent Q dashboard mockups', '<nav><a href="../index.html">Full specification</a><a href="manifest.json">Asset manifest</a></nav>', ''.join(figures)))
print('Rendered docs/index.html and docs/design/index.html')
