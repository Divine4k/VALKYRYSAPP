"""Wrap the run holding a date in a Word date-picker content control.

usage: add_date_picker.py IN.docx OUT.docx DATE_TEXT ISO_DATE
e.g.   add_date_picker.py in.docx out.docx 29/10/2026 2026-10-29
"""
import re
import sys
import zipfile

src, out, text, iso = sys.argv[1:5]

with zipfile.ZipFile(src) as zin:
    xml = zin.read("word/document.xml").decode("utf8")
    pat = re.compile(r"<w:r>(?:(?!<w:r>).)*?" + re.escape(text) + r"</w:t></w:r>", re.S)
    runs = pat.findall(xml)
    assert len(runs) == 1, f"date run found {len(runs)} times"
    run = runs[0]
    rpr = re.search(r"<w:rPr>.*?</w:rPr>", run, re.S)
    rpr = rpr.group(0) if rpr else ""

    sdt = (
        "<w:sdt><w:sdtPr>"
        + rpr
        + '<w:alias w:val="Datum"/><w:tag w:val="Datum"/><w:id w:val="738215604"/>'
        + f'<w:date w:fullDate="{iso}T00:00:00Z">'
        + '<w:dateFormat w:val="dd/MM/yyyy"/><w:lid w:val="nl-NL"/>'
        + '<w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/>'
        + "</w:date></w:sdtPr><w:sdtContent>"
        + run
        + "</w:sdtContent></w:sdt>"
    )
    xml = xml.replace(run, sdt, 1)

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            if item.filename.endswith("/"):
                continue
            data = xml.encode("utf8") if item.filename == "word/document.xml" else zin.read(item.filename)
            zout.writestr(item, data)

print("date picker added around", repr(text))
