// electron-app/drives.js: a folder on a USB stick that came back under another drive letter
import { createRequire } from "module"; const require = createRequire(import.meta.url);
const D = require("../electron-app/drives.js");
let fails = 0; const eq = (a, b, m) => { const ok = JSON.stringify(a) === JSON.stringify(b); console.log((ok ? "PASS " : "FAIL ") + m + (ok ? "" : "  -> " + JSON.stringify({ got: a, want: b }))); if (!ok) fails++; };
const disk = (...dirs) => (p) => dirs.includes(p);
eq(D.movedPath("E:\\Facturen\\2026", disk("F:\\Facturen\\2026")), "F:\\Facturen\\2026", "E: → F: when only F: has the folder");
eq(D.movedPath("E:\\Facturen\\", disk("G:\\Facturen")), "G:\\Facturen", "a trailing backslash is fine");
eq(D.movedPath("E:/Facturen", disk("F:\\Facturen")), "F:\\Facturen", "forward slashes too");
eq(D.movedPath("E:\\Facturen", disk("F:\\Facturen", "G:\\Facturen")), "", "two drives with that folder: no guess");
eq(D.movedPath("E:\\Facturen", disk()), "", "nowhere: nothing");
eq(D.movedPath("E:\\", disk("F:\\")), "", "a drive root alone: nothing");
eq(D.movedPath("\\\\server\\share\\Facturen", disk("F:\\server\\share\\Facturen")), "", "network paths are left alone");
eq(D.movedPath("E:\\Facturen", disk("C:\\Facturen")), "", "never the system drive");
eq(D.movedPath("e:\\Facturen", disk("E:\\Facturen", "F:\\Facturen")), "F:\\Facturen", "the old letter itself is not a candidate");
let t = 0; const f = D.finder(disk("F:\\X"), { now: () => t, everyMs: 3000 });
eq(f("E:\\X"), "F:\\X", "finder: found"); t = 1000; eq(f("E:\\X"), "", "finder: not again within 3 s"); t = 4000; eq(f("E:\\X"), "F:\\X", "finder: again after 3 s");
if (fails) process.exitCode = 1;
