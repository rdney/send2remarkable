# Send to reMarkable (Zotero plugin)

Send PDFs from Zotero to a reMarkable tablet, keep a whole collection in sync, and bring your marked-up PDFs back as attachments.

> **Status:** early release. Developed and tested on Zotero 10.0.9 on macOS. Unofficial; not affiliated with Zotero or reMarkable AS.

## Features

- **Send to reMarkable** – right-click an item to upload its PDF to your tablet.
- **Get annotated PDF from reMarkable** – right-click an item to fetch the marked-up version and attach it to the item.
- **Sync collection with reMarkable** – right-click a collection to:
  - mirror the collection tree as folders on the tablet (`/Zotero/<collection>/<subcollection>`),
  - upload new PDFs,
  - fetch PDFs you have actually annotated on the tablet and attach them as **Annotated (reMarkable)**, replacing the previous annotated copy (the old one goes to the Zotero trash, so it is recoverable).
- Nothing is ever deleted from the tablet.

## Requirements

- Zotero 7 or newer (tested on 10.0.9)
- [`rmapi`](https://github.com/ddvk/rmapi) (use the `ddvk` fork) installed and paired with your reMarkable cloud account
- A reMarkable account whose cloud sync works for your tablet (reMarkable's own terms and subscription rules apply)
- macOS or Linux (the plugin shells out to `/bin/sh` and `unzip`)

## Install

1. Install `rmapi`: download the build for your system from the [releases page](https://github.com/ddvk/rmapi/releases), put it on your `PATH` (for example `/usr/local/bin`), and run `rmapi` once to pair it with a one-time code from <https://my.remarkable.com/device/desktop/connect>.
2. Download the latest `send2remarkable-x.y.z.xpi` from the [Releases](https://github.com/rdney/send2remarkable/releases) page.
3. In Zotero: **Tools > Plugins**, drag the `.xpi` into the window.

The plugin finds `rmapi` in `/opt/homebrew/bin`, `/usr/local/bin`, `~/go/bin`, `~/.local/bin` and `/usr/bin`.

## Settings

Open **Zotero > Settings > reMarkable**:

- **Folder on the tablet** – root folder for uploads (default `/Zotero`).
- **Path to rmapi** – leave empty to search the usual locations, or enter the full path. The **Check rmapi** button shows which `rmapi` the plugin will use.

## How sync decides what to do

- A PDF is uploaded once, as `<Author Year - Title>`, into the folder for its collection.
- To detect annotations, the plugin downloads the raw document and looks for ink pages (`.rm`) and highlight data. No ink means "unchanged". If there is ink, a fingerprint of those files is compared with the last one seen, and a new annotated PDF is fetched only if it differs.
- When `rmapi stat` reports an unchanged modification time, the document is skipped without downloading.
- Bookkeeping is stored in `remarkable-sync.json` in your Zotero data directory.

## Limitations

- The tablet name is derived from author, year and title. Changing those in Zotero makes the next sync upload the item again as a new document.
- Annotations come back as ink baked into the PDF pages, not as editable annotations in Zotero's sidebar.
- Very faint marks may fall under the size threshold used to detect ink.
- Large collections sync slowly, because documents are checked one at a time.
- Only PDF attachments are supported.

## Troubleshooting

- **"rmapi not found"** – install it, or set `extensions.zotero-remarkable.rmapiPath`.
- **Folder not visible on the tablet** – force a sync on the tablet. `rmapi find /` shows what is in the cloud.
- **Install fails** – open the Browser Console (Tools > Developer > Browser Console) and look for lines mentioning `zotero-remarkable`. (Zotero 10 requires `update_url` in the manifest.)
- Failed items are listed in the dialog that appears at the end of a sync; details are in Help > Debug Output Logging.

## Build

```sh
./build.sh      # creates dist/send2remarkable-<version>.xpi
```

The plugin is plain JavaScript (`bootstrap.js`) with no build step.

## License

Copyright (C) 2026 Rodney. Licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later), the same license family as Zotero.

## Releasing

1. Bump `version` in `manifest.json`, and update `version` and `update_link` in `updates.json`. Commit and push to `main`.
2. On GitHub open **Actions > Release > Run workflow**. It builds the `.xpi` and publishes release `v<version>` with the file attached.
   (Pushing a tag such as `v0.3.3` triggers the same workflow.)
