"""Give electron.exe our icon and version info (a small rcedit): rebuilds the resource section inside the same space."""
import struct, sys

def u16(b, o): return struct.unpack_from("<H", b, o)[0]
def u32(b, o): return struct.unpack_from("<I", b, o)[0]

def parse_pe(b):
    pe = u32(b, 0x3C); assert b[pe:pe + 4] == b"PE\0\0"
    nsec = u16(b, pe + 6); opt = u16(b, pe + 20); o = pe + 24
    assert u16(b, o) == 0x20B
    dd = o + 112
    secs = []
    so = o + opt
    for i in range(nsec):
        h = so + 40 * i
        nm, vs, va, rs, rp = struct.unpack_from("<8sIIII", b, h)
        secs.append(dict(name=nm.rstrip(b"\0"), vs=vs, va=va, rs=rs, rp=rp, hdr=h))
    return dict(dd=dd, secs=secs)

def read_tree(b, base, va, off=0):
    """-> {id: subtree | (data, codepage)}"""
    n = u16(b, base + off + 12) + u16(b, base + off + 14)
    out = {}
    for i in range(n):
        nid, tgt = struct.unpack_from("<II", b, base + off + 16 + 8 * i)
        assert not (nid & 0x80000000), "named resource entries are not supported"
        if tgt & 0x80000000: out[nid] = read_tree(b, base, va, tgt & 0x7FFFFFFF)
        else:
            d, sz, cp, _ = struct.unpack_from("<IIII", b, base + tgt)
            out[nid] = (bytes(b[base + d - va: base + d - va + sz]), cp)
    return out

def write_tree(tree, va):
    # directories first (breadth first), then data entries, then raw data
    dirs, entries, raws = [], [], []
    def count(t):
        return 16 + 8 * len(t)
    layout = {}
    order = []
    def collect(t, path):
        order.append((path, t))
        for k in sorted(t):
            if isinstance(t[k], dict): collect(t[k], path + (k,))
    collect(tree, ())
    pos = 0
    for path, t in order: layout[path] = pos; pos += count(t)
    leaves = []
    for path, t in order:
        for k in sorted(t):
            if not isinstance(t[k], dict): leaves.append(path + (k,))
    entry_off = {}
    for p in leaves: entry_off[p] = pos; pos += 16
    data_off = {}; blob = b""
    for p in leaves:
        t = tree
        for k in p: t = t[k]
        blob += b"\0" * ((-(pos + len(blob))) % 8)
        data_off[p] = pos + len(blob); blob += t[0]
    out = bytearray()
    for path, t in order:
        out += struct.pack("<IIHHHH", 0, 0, 0, 0, 0, len(t))
        for k in sorted(t):
            if isinstance(t[k], dict): out += struct.pack("<II", k, 0x80000000 | layout[path + (k,)])
            else: out += struct.pack("<II", k, entry_off[path + (k,)])
    for p in leaves:
        t = tree
        for k in p: t = t[k]
        out += struct.pack("<IIII", va + data_off[p], len(t[0]), t[1], 0)
    out += blob
    return bytes(out)

def vnode(key, value=b"", wtype=1, children=b"", vlen=None):
    k = key.encode("utf-16-le") + b"\0\0"
    head = struct.pack("<HHH", 0, len(value) // (2 if wtype == 1 else 1) if vlen is None else vlen, wtype) + k
    head += b"\0" * ((-len(head)) % 4)
    body = value + b"\0" * ((-len(value)) % 4) if value else b""
    node = head + body + children
    node += b"\0" * ((-len(node)) % 4)
    return struct.pack("<H", len(node)) + node[2:] if False else struct.pack("<H", len(node.rstrip(b"\0")) if False else len(node)) + node[2:]

def version_info(strings, ver=(1, 0, 0, 0)):
    ms, ls = (ver[0] << 16) | ver[1], (ver[2] << 16) | ver[3]
    fixed = struct.pack("<IIIIIIIIIIIII", 0xFEEF04BD, 0x10000, ms, ls, ms, ls, 0x3F, 0, 0x40004, 1, 0, 0, 0)
    def s(key, val):
        v = (val + "\0").encode("utf-16-le")
        return vnode(key, v, 1, vlen=len(val) + 1)
    table = vnode("040904b0", b"", 1, b"".join(s(k, v) for k, v in strings), vlen=0)
    sfi = vnode("StringFileInfo", b"", 1, table, vlen=0)
    var = vnode("Translation", struct.pack("<I", 0x04B00409), 0, vlen=4)
    vfi = vnode("VarFileInfo", b"", 1, var, vlen=0)
    return vnode("VS_VERSION_INFO", fixed, 0, sfi + vfi, vlen=52)

def ico_images(path):
    b = open(path, "rb").read(); n = u16(b, 4); out = []
    for i in range(n):
        w, h, cc, _r, planes, bpp, size, off = struct.unpack_from("<BBBBHHII", b, 6 + 16 * i)
        out.append(dict(w=w, h=h, cc=cc, planes=planes or 1, bpp=bpp or 32, data=b[off:off + size]))
    return out

def patch(exe_in, exe_out, ico, strings, ver):
    b = bytearray(open(exe_in, "rb").read())
    pe = parse_pe(b)
    rs = [s for s in pe["secs"] if s["name"] == b".rsrc"][0]
    tree = read_tree(b, rs["rp"], rs["va"])
    print("original resource types:", {k: sum(len(v) if isinstance(v, dict) else 1 for v in t.values()) for k, t in tree.items()})
    imgs = ico_images(ico)
    grp = struct.pack("<HHH", 0, 1, len(imgs)) + b"".join(struct.pack("<BBBBHHIH", im["w"], im["h"], im["cc"], 0, im["planes"], im["bpp"], len(im["data"]), i + 1) for i, im in enumerate(imgs))
    tree[3] = {i + 1: {1033: (im["data"], 0)} for i, im in enumerate(imgs)}
    tree[14] = {1: {1033: (grp, 0)}}
    tree[16] = {1: {1033: (version_info(strings, ver), 0)}}
    new = write_tree(tree, rs["va"])
    assert len(new) <= rs["rs"], f"resources too big ({len(new)} > {rs['rs']})"
    b[rs["rp"]:rs["rp"] + rs["rs"]] = new + b"\0" * (rs["rs"] - len(new))
    struct.pack_into("<I", b, pe["dd"] + 8 * 2 + 4, len(new))  # data directory size of the resource table
    open(exe_out, "wb").write(b)
    # read back to prove it parses
    b2 = open(exe_out, "rb").read(); pe2 = parse_pe(b2); rs2 = [s for s in pe2["secs"] if s["name"] == b".rsrc"][0]
    t2 = read_tree(b2, rs2["rp"], rs2["va"])
    print("patched resource types:", {k: sum(len(v) if isinstance(v, dict) else 1 for v in t.values()) for k, t in t2.items()}, "| used", len(new), "of", rs["rs"])
    return t2

if __name__ == "__main__":
    S = [("CompanyName", "Valkyrys"), ("FileDescription", "Valkyrys app"), ("FileVersion", "1.0.0"), ("InternalName", "Valkyrys app"),
         ("LegalCopyright", "Valkyrys"), ("OriginalFilename", "Valkyrys app.exe"), ("ProductName", "Valkyrys app"), ("ProductVersion", "1.0.0")]
    patch(sys.argv[1], sys.argv[2], sys.argv[3], S, (1, 0, 0, 0))
