// copies the font library (needed for the Calibri-like invoice font) from node_modules into the app, so the finished app works offline
const fs = require("fs"), path = require("path");
const from = path.join(__dirname, "node_modules", "@pdf-lib", "fontkit", "dist", "fontkit.umd.min.js");
const to = path.join(__dirname, "web", "vendor", "fontkit.umd.min.js");
if (!fs.existsSync(from)) { console.error("fontkit not found: run npm install first"); process.exit(1); }
fs.copyFileSync(from, to); console.log("fontkit copied");
