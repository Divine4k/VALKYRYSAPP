"""Replace the @@XLOBJ@@ placeholder paragraph in a docx with an embedded Excel worksheet object.

usage: inject_ole.py BASE.docx WORKBOOK.xlsx PREVIEW.png OUT.docx WIDTH_PT
"""
import re
import sys
import zipfile

from PIL import Image

base, xlsx, preview, out, width_pt = sys.argv[1:6]
width_pt = float(width_pt)
pw, ph = Image.open(preview).size
height_pt = round(width_pt * ph / pw, 2)
# original size = the range's natural size in Excel; Word keeps the shown/original scale after edits
orig_w = float(sys.argv[6]) if len(sys.argv) > 6 else width_pt
orig_h = float(sys.argv[7]) if len(sys.argv) > 7 else height_pt

RID_IMG, RID_PKG = "rIdXlPreview", "rIdXlPackage"
IMG_NAME = "media/excel_preview.png"
PKG_NAME = "embeddings/Microsoft_Excel_Worksheet.xlsx"

SHAPETYPE = (
    '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" '
    'path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas>'
    '<v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/>'
    '<v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/>'
    '<v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/>'
    '<v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/>'
    '</v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/>'
    '<o:lock v:ext="edit" aspectratio="t"/></v:shapetype>'
)

OBJECT_PARA = (
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r>'
    f'<w:object w:dxaOrig="{round(orig_w * 20)}" w:dyaOrig="{round(orig_h * 20)}">'
    + SHAPETYPE
    + f'<v:shape id="_x0000_i1025" type="#_x0000_t75" style="width:{width_pt}pt;height:{height_pt}pt" o:ole="">'
    f'<v:imagedata r:id="{RID_IMG}" o:title=""/></v:shape>'
    f'<o:OLEObject Type="Embed" ProgID="Excel.Sheet.12" ShapeID="_x0000_i1025" DrawAspect="Content" '
    f'ObjectID="_1794161500" r:id="{RID_PKG}"/>'
    "</w:object></w:r></w:p>"
)

with zipfile.ZipFile(base) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
    names = zin.namelist()
    for item in zin.infolist():
        if item.filename.endswith("/"):
            continue
        data = zin.read(item.filename)
        if item.filename == "word/document.xml":
            xml = data.decode("utf8")
            pat = re.compile(r"<w:p>(?:(?!<w:p>).)*?@@XLOBJ@@.*?</w:p>", re.S)
            xml, n = pat.subn(OBJECT_PARA, xml)
            assert n == 1, f"placeholder found {n} times"
            for ns in ('xmlns:v="urn:schemas-microsoft-com:vml"', 'xmlns:o="urn:schemas-microsoft-com:office:office"'):
                assert ns in xml[:3000], "missing namespace " + ns
            data = xml.encode("utf8")
        elif item.filename == "word/_rels/document.xml.rels":
            xml = data.decode("utf8")
            rels = (
                f'<Relationship Id="{RID_IMG}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{IMG_NAME}"/>'
                f'<Relationship Id="{RID_PKG}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="{PKG_NAME}"/>'
            )
            xml = xml.replace("</Relationships>", rels + "</Relationships>")
            data = xml.encode("utf8")
        elif item.filename == "[Content_Types].xml":
            xml = data.decode("utf8")
            if 'Extension="xlsx"' not in xml:
                xml = xml.replace(
                    "<Default ",
                    '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/><Default ',
                    1,
                )
            if 'Extension="png"' not in xml:
                xml = xml.replace("<Default ", '<Default Extension="png" ContentType="image/png"/><Default ', 1)
            data = xml.encode("utf8")
        zout.writestr(item, data)
    zout.write(preview, "word/" + IMG_NAME)
    zout.write(xlsx, "word/" + PKG_NAME)

print(f"embedded Excel object {width_pt} x {height_pt} pt -> {out}")
