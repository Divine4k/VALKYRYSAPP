// Folders on a USB stick or an external drive: Windows may give the drive another letter when it is plugged in again
// (E: today, F: tomorrow, another letter on another computer). When a chosen folder is not there, the same folder on
// another drive letter is used, but only if exactly one drive has it (never a guess between two).
"use strict";

const LETTERS = "DEFGHIJKLMNOPQRSTUVWXYZ".split(""); // A/B floppies, C: the system drive

/** "E:\Facturen\2026" → "F:\Facturen\2026" when only F: has that folder; "" when nothing (or more than one) fits. */
function movedPath(p, isDir, letters = LETTERS) {
  const m = /^([A-Za-z]):[\\/](.+)$/.exec(String(p || "")); if (!m) return "";
  const rest = m[2].replace(/[\\/]+$/, ""); if (!rest) return ""; // a drive root alone says nothing about which drive it was
  const hits = letters.filter((l) => l.toUpperCase() !== m[1].toUpperCase()).map((l) => `${l}:\\${rest}`).filter((c) => isDir(c));
  return hits.length === 1 ? hits[0] : "";
}

/** Looks for a moved folder at most once every few seconds per path (stat on an empty drive letter is quick, but not free). */
function finder(isDir, { everyMs = 3000, letters = LETTERS, now = () => Date.now() } = {}) {
  const last = new Map();
  return (p) => {
    const t = now(); if (last.has(p) && t - last.get(p) < everyMs) return "";
    last.set(p, t); return movedPath(p, isDir, letters);
  };
}

module.exports = { movedPath, finder, LETTERS };
