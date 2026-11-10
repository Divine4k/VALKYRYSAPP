"""Wrap the invoice number in a text content control and the date in a date picker.

usage: add_controls.py IN.docx OUT.docx NUMBER_TEXT DATE_TEXT ISO_DATE
e.g.   add_controls.py in.docx out.docx 61-2026 29/10/2026 2026-10-29
Tags: "Factuurnummer" and "Datum" (the Word macro looks them up by tag).
"""
import re
import sys
import zipfile

src, out, number, date_text, iso = sys.argv[1:6]


def wrap(xml, text, props, cid):
    pat = re.compile(r"<w:r>(?:(?!<w:r>).)*?" + re.escape(text) + r"</w:t></w:r>", re.S)
    runs = pat.findall(xml)
    assert len(runs) == 1, f"{text!r} found {len(runs)} times"
    run = runs[0]
    rpr = re.search(r"<w:rPr>.*?</w:rPr>", run, re.S)
    rpr = rpr.group(0) if rpr else ""
    sdt = f"<w:sdt><w:sdtPr>{rpr}{props(cid)}</w:sdtPr><w:sdtContent>{run}</w:sdtContent></w:sdt>"
    return xml.replace(run, sdt, 1)


number_props = lambda cid: (
    f'<w:alias w:val="Factuurnummer"/><w:tag w:val="Factuurnummer"/><w:id w:val="{cid}"/><w:text/>'
)
date_props = lambda cid: (
    f'<w:alias w:val="Datum"/><w:tag w:val="Datum"/><w:id w:val="{cid}"/>'
    f'<w:date w:fullDate="{iso}T00:00:00Z"><w:dateFormat w:val="dd/MM/yyyy"/><w:lid w:val="nl-NL"/>'
    '<w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date>'
)

with zipfile.ZipFile(src) as zin:
    xml = zin.read("word/document.xml").decode("utf8")
    assert "<w:sdt>" not in xml, "input already has content controls"
    xml = wrap(xml, number, number_props, 738215603)
    xml = wrap(xml, date_text, date_props, 738215604)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            if item.filename.endswith("/"):
                continue
            data = xml.encode("utf8") if item.filename == "word/document.xml" else zin.read(item.filename)
            zout.writestr(item, data)

print("content controls added: Factuurnummer, Datum")
