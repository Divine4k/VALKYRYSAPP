"""Make a Windows resource object (.syso) that carries an icon, for go build (GOOS=windows GOARCH=amd64)."""
import struct, sys

def ico_images(path):
    b = open(path, "rb").read()
    _, typ, n = struct.unpack_from("<HHH", b, 0)
    out = []
    for i in range(n):
        w, h, cc, _r, planes, bpp, size, off = struct.unpack_from("<BBBBHHII", b, 6 + 16 * i)
        out.append(dict(w=w, h=h, cc=cc, planes=planes or 1, bpp=bpp or 32, data=b[off:off + size]))
    return out

MANIFEST = b"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity type="win32" name="Valkyrys.App.Setup" version="1.0.0.0" processorArchitecture="amd64"/>
  <description>Valkyrys app</description>
  <dependency><dependentAssembly>
    <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
  </dependentAssembly></dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges>
    <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
  </requestedPrivileges></security></trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1"><application>
    <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
    <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}"/>
  </application></compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings>
    <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware>
    <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">system</dpiAwareness>
  </windowsSettings></application>
</assembly>
"""

def build(ico, out, manifest=MANIFEST):
    imgs = ico_images(ico)
    # resources: RT_ICON (3) ids 1..n, RT_GROUP_ICON (14) id 1
    grp = struct.pack("<HHH", 0, 1, len(imgs)) + b"".join(
        struct.pack("<BBBBHHIH", im["w"], im["h"], im["cc"], 0, im["planes"], im["bpp"], len(im["data"]), i + 1) for i, im in enumerate(imgs))
    res = {3: [(i + 1, im["data"]) for i, im in enumerate(imgs)], 14: [(1, grp)]}
    if manifest: res[24] = [(1, manifest)]  # RT_MANIFEST
    types = sorted(res)

    def dir_size(n): return 16 + 8 * n
    # layout: root dir | type dirs | lang dirs | data entries | raw data
    root_sz = dir_size(len(types))
    pos = root_sz
    type_dir_off, name_dir_off = {}, {}
    for t in types:
        type_dir_off[t] = pos; pos += dir_size(len(res[t]))
    for t in types:
        for (rid, _) in res[t]:
            name_dir_off[(t, rid)] = pos; pos += dir_size(1)
    entry_off = {}
    for t in types:
        for (rid, _) in res[t]:
            entry_off[(t, rid)] = pos; pos += 16
    raw_off = {}
    blobs = b""
    base = pos
    for t in types:
        for (rid, data) in res[t]:
            pad = (-len(blobs)) % 8; blobs += b"\0" * pad
            raw_off[(t, rid)] = base + len(blobs); blobs += data
    sec = bytearray()
    def d(entries):  # resource directory: no names, ids only
        return struct.pack("<IIHHHH", 0, 0, 0, 0, 0, len(entries)) + b"".join(struct.pack("<II", i, o) for i, o in entries)
    sec += d([(t, 0x80000000 | type_dir_off[t]) for t in types])
    for t in types: sec += d([(rid, 0x80000000 | name_dir_off[(t, rid)]) for rid, _ in res[t]])
    for t in types:
        for rid, _ in res[t]: sec += d([(0x0409, entry_off[(t, rid)])])
    relocs = []
    for t in types:
        for rid, data in res[t]:
            relocs.append(len(sec))  # offset of the OffsetToData field
            sec += struct.pack("<IIII", raw_off[(t, rid)], len(data), 0, 0)
    assert len(sec) == base
    sec += blobs
    while len(sec) % 4: sec += b"\0"
    nrel = len(relocs)
    ptr_raw = 20 + 40
    ptr_rel = ptr_raw + len(sec)
    ptr_sym = ptr_rel + 10 * nrel
    f = struct.pack("<HHIIIHH", 0x8664, 1, 0, ptr_sym, 1, 0, 0)
    f += struct.pack("<8sIIIIIIHHI", b".rsrc", 0, 0, len(sec), ptr_raw, ptr_rel, 0, nrel, 0, 0x40000040)
    f += bytes(sec)
    for r in relocs: f += struct.pack("<IIH", r, 0, 3)  # IMAGE_REL_AMD64_ADDR32NB against symbol 0
    f += struct.pack("<8sIhHBB", b".rsrc", 0, 1, 0, 3, 0)  # section symbol
    f += struct.pack("<I", 4)  # empty string table
    open(out, "wb").write(f)

if __name__ == "__main__": build(sys.argv[1], sys.argv[2])
