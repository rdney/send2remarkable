/*
 * Minimal reader for reMarkable ".rm" (lines version 6) page files.
 * Extracts only text highlights ("glyph ranges"); everything else is skipped.
 * Copyright (C) 2026 Rodney
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Format reference: the open-source `rmscene` project (MIT).
 */
var RM_COLORS = { 0: "black", 1: "grey", 2: "white", 3: "yellow", 4: "green", 5: "pink", 6: "blue", 7: "red", 8: "grey", 9: "highlight" };

function parseGlyphs(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const HEADER = "reMarkable .lines file, version=6";
  let head = "";
  for (let i = 0; i < HEADER.length; i++) head += String.fromCharCode(bytes[i]);
  if (head !== HEADER) throw new Error("not a v6 .rm file");
  let pos = 43; // header is padded to 43 bytes
  const out = [];

  const dec = (u8) => new TextDecoder("utf-8").decode(u8);

  while (pos + 8 <= bytes.length) {
    const blockLen = dv.getUint32(pos, true);
    const blockType = bytes[pos + 7];
    const start = pos + 8;
    const end = start + blockLen;
    pos = end;
    if (blockType !== 0x03 || end > bytes.length) continue;
    try {
      let p = start;
      const varuint = () => {
        let r = 0, shift = 0;
        for (;;) {
          const b = bytes[p++];
          r += (b & 0x7f) * Math.pow(2, shift);
          shift += 7;
          if (!(b & 0x80)) return r;
        }
      };
      const tag = () => { const x = varuint(); return [x >> 4, x & 0xf]; };
      const peekTag = () => { const s = p; const t = tag(); p = s; return t; };
      const expect = (idx, type) => {
        const [i, t] = tag();
        if (i !== idx || t !== type) throw new Error("unexpected tag");
      };
      const readId = (idx) => { expect(idx, 0xf); p++; varuint(); };
      const readInt = (idx) => { expect(idx, 0x4); const v = dv.getUint32(p, true); p += 4; return v; };
      const optInt = (idx) => { const [i, t] = peekTag(); return (i === idx && t === 0x4) ? readInt(idx) : null; };

      readId(1); readId(2); readId(3); readId(4);
      readInt(5);
      // item value subblock (absent for deleted items)
      if (p >= end || peekTag()[0] !== 6 || peekTag()[1] !== 0xc) continue;
      expect(6, 0xc);
      const subLen = dv.getUint32(p, true); p += 4;
      const subEnd = p + subLen;
      const itemType = bytes[p++];
      if (itemType !== 0x01) continue;

      let gStart = optInt(2);
      let gLen = optInt(3);
      const color = readInt(4);
      expect(5, 0xc);
      const sLen = dv.getUint32(p, true); p += 4;
      const strLen = varuint();
      p++; // is-ascii flag
      const text = dec(bytes.subarray(p, p + strLen));
      p += strLen;
      let y = null, x = null;
      if (p < subEnd) {
        expect(6, 0xc);
        const rLen = dv.getUint32(p, true); p += 4;
        const n = varuint();
        if (n > 0) { x = dv.getFloat64(p, true); y = dv.getFloat64(p + 8, true); }
        p += n * 32;
      }
      if (gLen === null) gLen = text.length;
      out.push({ start: gStart === null ? 0 : gStart, length: gLen, color, text, x, y });
    } catch (e) {
      // skip blocks we cannot read
    }
  }
  return out;
}

// Join the per-line fragments the tablet stores into whole highlights.
function mergeGlyphs(glyphs) {
  const g = glyphs.slice().sort((a, b) => a.start - b.start);
  const out = [];
  let cur = null;
  for (const x of g) {
    const gap = cur ? x.start - (cur.start + cur.length) : 99;
    // a gap of up to 3 characters is a line wrap; 4 only counts when the next line is directly below
    const below = cur && cur.lastY !== null && x.y !== null && Math.abs(x.y - cur.lastY) <= 60;
    if (cur && cur.color === x.color && (gap <= 3 || (gap === 4 && below))) {
      cur.length = x.start + x.length - cur.start;
      cur.text += " " + x.text.trim();
      cur.lastY = x.y;
    } else {
      if (cur) out.push(cur);
      cur = { start: x.start, length: x.length, color: x.color, text: x.text.trim(), lastY: x.y };
    }
  }
  if (cur) out.push(cur);
  return out.map(({ start, length, color, text }) => ({ start, length, color, text: text.replace(/\s+/g, " ").trim() }));
}

if (typeof module !== "undefined") module.exports = { parseGlyphs, mergeGlyphs, RM_COLORS };
