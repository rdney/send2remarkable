/*
 * Send to reMarkable - Zotero plugin
 * Copyright (C) 2026 Rodney
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/* Send to reMarkable - Zotero 7 bootstrapped plugin */
var ZoteroRemarkable;

function install() {}
function uninstall() {}

async function startup({ id, version, rootURI }) {
  ZoteroRemarkable = {
    id, version, rootURI,
    menuIDs: [],
    PREF: "extensions.zotero-remarkable.",

    pref(name) { return Zotero.Prefs.get(this.PREF + name, true); },

    boolPref(name) { return !!Zotero.Prefs.get(this.PREF + name, true); },

    esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },

    buildNoteHtml(res) {
      const date = new Date().toISOString().slice(0, 10);
      let h = `<h2>reMarkable highlights</h2><p><em>Imported ${date}. This note is regenerated when the tablet document changes; copy anything you want to keep into another note.</em></p>`;
      for (const p of res.pages) {
        h += `<h3>${p.page ? "Page " + p.page : "Page ?"}</h3>`;
        for (const hl of p.highlights) {
          const c = this.rm.RM_COLORS[hl.color];
          const tag = c && c !== "yellow" ? ` <em>(${c})</em>` : "";
          h += `<blockquote><p>${this.esc(hl.text)}${tag}</p></blockquote>`;
        }
      }
      if (res.inkPages.length) {
        h += `<p><em>Handwriting or drawings on page ${res.inkPages.filter(n => n).join(", ")}: see the annotated PDF.</em></p>`;
      }
      return h;
    },

    async upsertNote(parentID, rec, html) {
      let note = rec.noteID ? Zotero.Items.get(rec.noteID) : null;
      if (note && !note.deleted) {
        if (note.getNote() !== html) { note.setNote(html); await note.saveTx(); }
      } else {
        note = new Zotero.Item("note");
        note.libraryID = Zotero.Items.get(parentID).libraryID;
        note.parentID = parentID;
        note.setNote(html);
        await note.saveTx();
      }
      rec.noteID = note.id;
    },

    // folder on the tablet: always absolute, no trailing slash
    folder() {
      let f = String(this.pref("folder") || "").trim();
      if (!f) f = "/Zotero";
      if (!f.startsWith("/")) f = "/" + f;
      f = f.replace(/\/+$/, "");
      return f || "/Zotero";
    },

    // used by the preference pane
    async checkRmapi(doc) {
      const el = doc.getElementById("send2remarkable-status");
      const set = (t) => { if (el) el.textContent = t; };
      set("Checking…");
      const p = await this.findRmapi();
      set(p ? "Found: " + p : "rmapi not found. Install it and pair it first (see the README), or enter its full path above.");
    },

    async findRmapi() {
      const custom = this.pref("rmapiPath");
      const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
      const candidates = [custom, "/opt/homebrew/bin/rmapi", "/usr/local/bin/rmapi",
        PathUtils.join(home, "go", "bin", "rmapi"), PathUtils.join(home, ".local", "bin", "rmapi"),
        "/usr/bin/rmapi"].filter(Boolean);
      for (const p of candidates) {
        if (await IOUtils.exists(p)) return p;
      }
      return null;
    },

    safeName(s) {
      return s.replace(/[\/\\:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    },

    async pdfFor(item) {
      let att = null;
      if (item.isAttachment()) {
        att = item;
      } else if (item.isRegularItem()) {
        att = await item.getBestAttachment();
      }
      if (!att || att.attachmentContentType !== "application/pdf") return null;
      const path = await att.getFilePathAsync();
      if (!path) return null;
      const parent = att.parentItem || item;
      const creators = parent.getCreators();
      const first = creators.length ? creators[0].lastName || creators[0].name || "" : "";
      const year = (parent.getField("date", true, true) || "").slice(0, 4);
      const title = parent.getField("title") || att.getField("title") || "Untitled";
      const label = this.safeName([first, year].filter(Boolean).join(" ") + (first || year ? " - " : "") + title);
      return { path, label, parentID: att.parentItemID || item.id, parentKey: parent.key };
    },

    async sendSelected(window) {
      const items = window.ZoteroPane.getSelectedItems();
      const pw = new Zotero.ProgressWindow({ closeOnClick: true });
      pw.changeHeadline("Send to reMarkable");
      pw.show();
      const line = new pw.ItemProgress("attachment-pdf", "Preparing…");
      try {
        const rmapi = await this.findRmapi();
        if (!rmapi) {
          throw new Error("rmapi not found. Install it (github.com/ddvk/rmapi), run it once to pair, "
            + "or set extensions.zotero-remarkable.rmapiPath in the Config Editor.");
        }
        const folder = this.folder();
        try { await Zotero.Utilities.Internal.exec(rmapi, ["mkdir", folder]); } catch (e) { /* exists */ }

        let sent = 0, skipped = 0, already = 0, failed = [];
        const st = await this.loadState();
        st.items = st.items || {};
        const tmpDir = PathUtils.join(PathUtils.tempDir, "zotero-remarkable");
        await IOUtils.makeDirectory(tmpDir, { ignoreExisting: true });

        for (const item of items) {
          const pdf = await this.pdfFor(item);
          if (!pdf) { skipped++; continue; }
          if (st.items[pdf.parentKey]) { already++; continue; }
          line.setText(this.trunc(pdf.label));
          const tmp = PathUtils.join(tmpDir, pdf.label + ".pdf");
          try {
            await IOUtils.copy(pdf.path, tmp, { noOverwrite: false });
            await Zotero.Utilities.Internal.exec(rmapi, ["put", tmp, folder]);
            const remote = `${folder}/${pdf.label}`;
            st.items[pdf.parentKey] = { remote, modified: await this.remoteModified(rmapi, remote), hash: null, fp: "" };
            await this.saveState(st);
            sent++;
          } catch (e) {
            failed.push(pdf.label);
            Zotero.logError(e);
          } finally {
            try { await IOUtils.remove(tmp); } catch (e) {}
          }
        }
        let msg = `Sent ${sent} PDF${sent === 1 ? "" : "s"} to ${folder}`;
        if (skipped) msg += `; ${skipped} without PDF`;
        if (already) msg += `; ${already} already on the tablet`;
        if (failed.length) msg += `; failed (already on tablet?): ${failed.join(", ")}`;
        line.setText(this.trunc(msg, 60));
        line.setProgress(100);
        if (failed.length) {
          pw.close();
          this.showSummary(window, "Send to reMarkable", [msg, "", "Failed (already on tablet?):", ...failed.map(f => "  • " + f)]);
          return;
        }
      } catch (e) {
        Zotero.logError(e);
        pw.close();
        this.showSummary(window, "reMarkable", ["Error:", "", e.message]);
        return;
      }
      pw.startCloseTimer(failedTimeout());
      function failedTimeout() { return 6000; }
    },

    shq(str) { return "'" + String(str).replace(/'/g, "'\\''") + "'"; },

    async getAnnotated(window) {
      const items = window.ZoteroPane.getSelectedItems();
      const pw = new Zotero.ProgressWindow({ closeOnClick: true });
      pw.changeHeadline("Get from reMarkable");
      pw.show();
      const line = new pw.ItemProgress("attachment-pdf", "Preparing…");
      try {
        const rmapi = await this.findRmapi();
        if (!rmapi) throw new Error("rmapi not found (see Send to reMarkable).");
        const st = await this.loadState();
        st.items = st.items || {};
        let got = 0;
        const missing = [];
        for (const item of items) {
          const pdf = await this.pdfFor(item);
          if (!pdf) continue;
          line.setText(this.trunc(pdf.label));
          const rec = st.items[pdf.parentKey];
          // where the sync (or a single send) put it; fall back to the root folder
          const remote = rec?.remote || `${this.folder()}/${pdf.label}`;
          const dir = PathUtils.join(PathUtils.tempDir, "zotero-remarkable-get-" + Date.now());
          await IOUtils.makeDirectory(dir, { ignoreExisting: true });
          try {
            const r = await this.sh(`cd ${this.shq(dir)} && ${this.shq(rmapi)} geta ${this.shq(remote)}`);
            const files = r.ok ? (await IOUtils.getChildren(dir)).filter(p => p.toLowerCase().endsWith(".pdf")) : [];
            if (!files.length) {
              missing.push(`${pdf.label}\n      looked for: ${remote}\n      ${(r.out || "no output").trim().split("\n").slice(-1)[0]}`);
              continue;
            }
            const att = await Zotero.Attachments.importFromFile({
              file: files[0], parentItemID: pdf.parentID, title: "Annotated (reMarkable)",
            });
            if (rec?.attID) {
              const old = Zotero.Items.get(rec.attID);
              if (old && !old.deleted) { old.deleted = true; await old.saveTx(); }
            }
            const res = await this.annotationFingerprint(rmapi, remote, PathUtils.join(dir, "fp")).catch(() => null);
            const newRec = {
              remote, attID: att.id, hash: await this.hashFile(files[0]), noteID: rec?.noteID,
              fp: res?.fp ?? rec?.fp ?? "", modified: await this.remoteModified(rmapi, remote),
            };
            if (this.boolPref("createNote") && res && res.pages.length) {
              await this.upsertNote(pdf.parentID, newRec, this.buildNoteHtml(res));
            }
            st.items[pdf.parentKey] = newRec;
            await this.saveState(st);
            got++;
          } catch (e) {
            missing.push(`${pdf.label}\n      ${e.message}`);
            Zotero.logError(e);
          } finally {
            try { await IOUtils.remove(dir, { recursive: true }); } catch (e) {}
          }
        }
        const msg = `Attached ${got} annotated PDF${got === 1 ? "" : "s"}`;
        line.setText(msg);
        line.setProgress(100);
        if (missing.length) {
          pw.close();
          this.showSummary(window, "Get from reMarkable", [msg, "", "Not found or failed:", ...missing.map(f => "  • " + f)]);
          return;
        }
      } catch (e) {
        Zotero.logError(e);
        pw.close();
        this.showSummary(window, "reMarkable", ["Error:", "", e.message]);
        return;
      }
      pw.startCloseTimer(6000);
    },

    // ---------- collection sync ----------
    stateFile() { return PathUtils.join(Zotero.DataDirectory.dir, "remarkable-sync.json"); },
    async loadState() {
      try { return JSON.parse(await IOUtils.readUTF8(this.stateFile())); } catch (e) { return { items: {} }; }
    },
    async saveState(st) { await IOUtils.writeUTF8(this.stateFile(), JSON.stringify(st, null, 1)); },

    // run a shell command, capture combined output
    async sh(cmd) {
      const tmp = PathUtils.join(PathUtils.tempDir, "zr-out-" + Math.random().toString(36).slice(2));
      let ok = true;
      try {
        await Zotero.Utilities.Internal.exec("/bin/sh", ["-c", `${cmd} > ${this.shq(tmp)} 2>&1`]);
      } catch (e) { ok = false; }
      let out = "";
      try { out = await IOUtils.readUTF8(tmp); await IOUtils.remove(tmp); } catch (e) {}
      return { ok, out };
    },

    async remoteModified(rmapi, path) {
      const r = await this.sh(`${this.shq(rmapi)} stat ${this.shq(path)}`);
      if (!r.ok) return null;
      const m = r.out.match(/"lastModified"\s*:\s*"?([^",}\s]+)/i);
      return m ? m[1] : null;
    },

    async hashFile(path) {
      try { return await Zotero.Utilities.Internal.md5Async(Zotero.File.pathToFile(path)); }
      catch (e) { return "size:" + (await IOUtils.stat(path)).size; }
    },

    selectedCollections(window) {
      const zp = window.ZoteroPane;
      const cols = zp.getSelectedCollections ? zp.getSelectedCollections() : [zp.getSelectedCollection()];
      return cols.filter(c => c && c.name !== undefined && c.id);
    },

    // Fingerprint of the ink/highlight files stored in the document on the tablet.
    // Empty string = no annotations at all.
    async annotationFingerprint(rmapi, remote, work) {
      await IOUtils.makeDirectory(work, { ignoreExisting: true });
      const r = await this.sh(`cd ${this.shq(work)} && ${this.shq(rmapi)} get ${this.shq(remote)}`);
      if (!r.ok) return null;
      const arch = (await IOUtils.getChildren(work)).find(p => /\.(rmdoc|zip)$/i.test(p));
      if (!arch) return null;
      const ex = PathUtils.join(work, "x");
      await IOUtils.makeDirectory(ex, { ignoreExisting: true });
      const u = await this.sh(`/usr/bin/unzip -o -q ${this.shq(arch)} -d ${this.shq(ex)}`);
      if (!u.ok) return null;
      const files = [];
      const walkDir = async (d) => {
        for (const p of await IOUtils.getChildren(d)) {
          const st = await IOUtils.stat(p);
          if (st.type === "directory") await walkDir(p);
          else files.push({ p, size: st.size });
        }
      };
      await walkDir(ex);
      // ink pages (.rm) with real content; highlight json with real content
      const res = { fp: "", pages: [], inkPages: [] };
      const rel = files.filter(f => (/\.rm$/i.test(f.p) && f.size > 200)
        || (/\.highlights\//i.test(f.p) && /\.json$/i.test(f.p) && f.size > 60));
      if (!rel.length) return res;
      rel.sort((a, b) => a.p.localeCompare(b.p));
      const parts = [];
      for (const f of rel) parts.push(PathUtils.filename(f.p) + ":" + await this.hashFile(f.p));
      res.fp = parts.join("|");

      // page order, then the text highlights on each page
      let order = [];
      try {
        const cf = files.find(f => /\.content$/i.test(f.p));
        const c = JSON.parse(await IOUtils.readUTF8(cf.p));
        order = (c.cPages && c.cPages.pages ? c.cPages.pages.map(p => p.id) : c.pages) || [];
      } catch (e) {}
      for (const f of rel) {
        if (!/\.rm$/i.test(f.p)) continue;
        const pid = PathUtils.filename(f.p).replace(/\.rm$/i, "");
        const pageNo = order.indexOf(pid) + 1;
        let hl = [];
        try { hl = this.rm.mergeGlyphs(this.rm.parseGlyphs(await IOUtils.read(f.p))); } catch (e) { Zotero.logError(e); }
        if (hl.length) res.pages.push({ page: pageNo, highlights: hl }); else res.inkPages.push(pageNo);
      }
      res.pages.sort((x, y) => x.page - y.page);
      res.inkPages.sort((x, y) => x - y);
      return res;
    },

    async syncCollections(window) {
      const cols = this.selectedCollections(window);
      const pw = new Zotero.ProgressWindow({ closeOnClick: true });
      pw.changeHeadline("Sync with reMarkable");
      pw.show();
      const line = new pw.ItemProgress("collection", "Preparing…");
      const stats = { pushed: 0, pulled: 0, unchanged: 0, nopdf: 0, failed: [] };
      try {
        if (!cols.length) throw new Error("Select a collection first.");
        const rmapi = await this.findRmapi();
        if (!rmapi) throw new Error("rmapi not found (see Send to reMarkable).");
        const root = this.folder();
        const st = await this.loadState();
        st.items = st.items || {};
        const made = new Set();
        let total = 0, done = 0;
        for (const c of cols) total += this.countItems(c);
        const tmpRoot = PathUtils.join(PathUtils.tempDir, "zotero-remarkable-sync-" + Date.now());
        await IOUtils.makeDirectory(tmpRoot, { ignoreExisting: true });

        const ensureDir = async (path) => {
          let cur = "";
          for (const part of path.split("/").filter(Boolean)) {
            cur += "/" + part;
            if (made.has(cur)) continue;
            await this.sh(`${this.shq(rmapi)} mkdir ${this.shq(cur)}`);
            made.add(cur);
          }
        };

        const syncItem = async (item, dir) => {
          const pdf = await this.pdfFor(item);
          if (!pdf) { stats.nopdf++; return; }
          line.setText(`${done + 1} / ${total}: ${this.trunc(pdf.label)}`);
          line.setProgress(Math.round((done / Math.max(total, 1)) * 100));
          const remote = `${dir}/${pdf.label}`;
          const rec = st.items[item.key];

          if (!rec || rec.remote !== remote) {
            const tmp = PathUtils.join(tmpRoot, pdf.label + ".pdf");
            await IOUtils.copy(pdf.path, tmp, { noOverwrite: false });
            const r = await this.sh(`${this.shq(rmapi)} put ${this.shq(tmp)} ${this.shq(dir)}`);
            try { await IOUtils.remove(tmp); } catch (e) {}
            if (!r.ok && !/exist/i.test(r.out)) { stats.failed.push(pdf.label); Zotero.debug("rm put: " + r.out); return; }
            st.items[item.key] = { remote, modified: await this.remoteModified(rmapi, remote), hash: null, fp: "", attID: rec?.attID };
            stats.pushed++;
            return;
          }

          const mod = await this.remoteModified(rmapi, remote);
          if (mod && mod === rec.modified) { stats.unchanged++; return; }

          const dl = PathUtils.join(tmpRoot, item.key);
          const res = await this.annotationFingerprint(rmapi, remote, dl);
          try { await IOUtils.remove(dl, { recursive: true }); } catch (e) {}
          if (res === null) { stats.failed.push(pdf.label); return; }
          const fp = res.fp;
          if (fp === "" || fp === (rec.fp || "")) { rec.modified = mod; stats.unchanged++; return; }

          if (this.boolPref("createNote") && res.pages.length) {
            await this.upsertNote(pdf.parentID, rec, this.buildNoteHtml(res));
          }
          if (this.boolPref("attachPdf")) {
            const dl2 = PathUtils.join(tmpRoot, item.key + "-pdf");
            await IOUtils.makeDirectory(dl2, { ignoreExisting: true });
            const r = await this.sh(`cd ${this.shq(dl2)} && ${this.shq(rmapi)} geta ${this.shq(remote)}`);
            const files = r.ok ? (await IOUtils.getChildren(dl2)).filter(p => p.toLowerCase().endsWith(".pdf")) : [];
            if (!files.length) { stats.failed.push(pdf.label); Zotero.debug("rm geta: " + r.out); return; }
            const hash = await this.hashFile(files[0]);
            const att = await Zotero.Attachments.importFromFile({
              file: files[0], parentItemID: pdf.parentID, title: "Annotated (reMarkable)",
            });
            if (rec.attID) {
              const old = Zotero.Items.get(rec.attID);
              if (old && !old.deleted) { old.deleted = true; await old.saveTx(); } // to Zotero trash, recoverable
            }
            rec.attID = att.id; rec.hash = hash;
          }
          rec.fp = fp; rec.modified = mod;
          stats.pulled++;
        };

        const walk = async (col, dir) => {
          const here = dir + "/" + this.safeName(col.name);
          await ensureDir(here);
          for (const item of col.getChildItems()) {
            if (!item.isRegularItem()) continue;
            try { await syncItem(item, here); } catch (e) { Zotero.logError(e); stats.failed.push(item.getField("title")); }
            done++;
            await this.saveState(st);
          }
          for (const sub of Zotero.Collections.getByParent(col.id)) await walk(sub, here);
        };

        for (const col of cols) await walk(col, root);
        try { await IOUtils.remove(tmpRoot, { recursive: true }); } catch (e) {}

        line.setText("Done");
        line.setProgress(100);
        pw.close();
        const out = [
          `Sent to tablet: ${stats.pushed}`,
          `Annotated copies fetched: ${stats.pulled}`,
          `Unchanged: ${stats.unchanged}`,
        ];
        if (stats.nopdf) out.push(`Skipped (no PDF): ${stats.nopdf}`);
        if (stats.failed.length) {
          out.push("", `Failed (${stats.failed.length}):`);
          for (const f of stats.failed) out.push("  • " + f);
        }
        this.showSummary(window, "Sync with reMarkable", out);
        return;
      } catch (e) {
        Zotero.logError(e);
        pw.close();
        this.showSummary(window, "Sync with reMarkable", ["Error:", "", e.message]);
      }
    },

    addToWindow(window) {
      const doc = window.document;
      const menu = doc.getElementById("zotero-itemmenu");
      if (!menu) return;
      const sep = doc.createXULElement("menuseparator");
      sep.id = "zotero-remarkable-sep";
      const mi = doc.createXULElement("menuitem");
      mi.id = "zotero-remarkable-send";
      mi.setAttribute("label", "Send to reMarkable");
      mi.addEventListener("command", () => this.sendSelected(window));
      const mi2 = doc.createXULElement("menuitem");
      mi2.id = "zotero-remarkable-get";
      mi2.setAttribute("label", "Get annotated PDF from reMarkable");
      mi2.addEventListener("command", () => this.getAnnotated(window));
      menu.append(sep, mi, mi2);
      this.menuIDs.push(sep.id, mi.id, mi2.id);
      const cmenu = doc.getElementById("zotero-collectionmenu");
      if (cmenu) {
        const csep = doc.createXULElement("menuseparator");
        csep.id = "zotero-remarkable-csep";
        const cmi = doc.createXULElement("menuitem");
        cmi.id = "zotero-remarkable-sync";
        cmi.setAttribute("label", "Sync collection with reMarkable");
        cmi.addEventListener("command", () => this.syncCollections(window));
        cmenu.append(csep, cmi);
        this.menuIDs.push(csep.id, cmi.id);
      }
    },

    removeFromWindow(window) {
      for (const id of this.menuIDs) window.document.getElementById(id)?.remove();
    },
  };

  const rmScope = {};
  Services.scriptloader.loadSubScript(rootURI + "rmparse.js", rmScope);
  ZoteroRemarkable.rm = rmScope;

  Zotero.Send2Remarkable = ZoteroRemarkable;
  Zotero.PreferencePanes.register({
    pluginID: id,
    src: rootURI + "prefs.xhtml",
    label: "reMarkable",
  });

  for (const win of Zotero.getMainWindows()) ZoteroRemarkable.addToWindow(win);
}

function onMainWindowLoad({ window }) { ZoteroRemarkable?.addToWindow(window); }
function onMainWindowUnload({ window }) { ZoteroRemarkable?.removeFromWindow(window); }

function shutdown() {
  if (!ZoteroRemarkable) return;
  for (const win of Zotero.getMainWindows()) ZoteroRemarkable.removeFromWindow(win);
  delete Zotero.Send2Remarkable;
  ZoteroRemarkable = undefined;
}
