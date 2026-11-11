# builds app/web from the published tool (CDN libraries -> local copies, plus a shim for storage and downloads)
# tool/index.html is the markup; css/, i18n/, js/ are copied as they are (the CDN script tags are only in index.html)
import shutil, re, os, sys
SP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T, W = f"{SP}/tool", f"{SP}/app/web"
shutil.rmtree(W, ignore_errors=True)
for d in ["vendor", "img", "fonts"]: os.makedirs(f"{W}/{d}")
for f in os.listdir(f"{T}/img"): shutil.copy(f"{T}/img/{f}", f"{W}/img/{f}")
for f in os.listdir(f"{T}/fonts"): shutil.copy(f"{T}/fonts/{f}", f"{W}/fonts/{f}")
for f in ["invoice-core.js", "invoice-docx.js", "invoice-templates.js", "changelog.js"]: shutil.copy(f"{T}/{f}", f"{W}/{f}")
shutil.copytree(f"{T}/templates", f"{W}/templates")
for d in ["css", "i18n", "js"]: shutil.copytree(f"{T}/{d}", f"{W}/{d}")  # the page's styles, texts and scripts (index.html is markup only)
shutil.copy(f"{T}/vendor/docx.iife.js", f"{W}/vendor/docx.iife.js")
shutil.copy("/opt/npm-tools/node_modules/pdf-lib/dist/pdf-lib.min.js", f"{W}/vendor/pdf-lib.min.js")
shutil.copy("/opt/npm-tools/node_modules/jszip/dist/jszip.min.js", f"{W}/vendor/jszip.min.js")
PJ = "/home/claude/.npm-global/lib/node_modules/pdfjs-dist/legacy/build"
shutil.copy(f"{PJ}/pdf.min.mjs", f"{W}/vendor/pdf.min.mjs")
shutil.copy(f"{PJ}/pdf.worker.min.mjs", f"{W}/vendor/pdf.worker.min.mjs")
shutil.copy(f"{SP}/app/shim.js", f"{W}/vendor/local-shim.js")
h = open(f"{T}/index.html", encoding="utf8").read()
rep = {
 '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"></script>': '<script src="vendor/local-shim.js"></script>\n<script src="vendor/pdf-lib.min.js"></script>',
 '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>': '',
 '<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>': '<script src="vendor/jszip.min.js"></script>',
}
for a, b in rep.items():
    assert a in h, a
    h = h.replace(a, b)
# the invoice font is embedded by invoice-core.js itself, no CDN library needed
fk = '<script src="https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js"></script>'
assert fk in h
h = h.replace(fk, '')
html = '<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/png" href="img/favicon.png"></head><body>' + h + '</body></html>'
open(f"{W}/index.html", "w", encoding="utf8").write(html)
print("web built", sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(W) for f in fs) // 1024, "KB")
