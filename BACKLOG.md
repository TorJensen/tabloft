# TabLoft backlog

## Done

- **Desktop installer (v0.2).** `TabLoft-Setup.exe` (about 23 MB) needs no Node.js and no admin rights. It adds a tray app, a Start Menu entry, optional autostart, an Add/Remove Programs entry, and an uninstaller that keeps the library. It also walks you through adding the extension to each browser. Built by `build/build.ps1`.

- **Automatic updates (v0.3).** The tray app checks GitHub Releases and installs new versions in one click; the extension reloads itself afterwards.

## Next

- **Code-sign the installer and exes** so SmartScreen stops warning about an unknown publisher. This needs a code-signing certificate, or Azure Trusted Signing (about $10/month).
- **Publish the extension** to the Chrome Web Store ($5 one-time fee; Brave uses the Chrome store too) and to Edge Add-ons (free). This removes the "Load unpacked" and developer-mode steps and the startup warning, and gives automatic extension updates.


## Later

- **Sync between computers.** A shared library across PCs, either through a home server or NAS, or export/import between machines. Don't share the SQLite file through OneDrive or Dropbox, because it can corrupt.
- **Snapshot history.** Keep earlier snapshots when a page is saved again, instead of replacing them.
- **Auto-suggested tags and collections** based on page content.
- **Resurface.** A weekly "you saved these and never looked" view of the Inbox.
- **Firefox support.** Firefox has no `pageCapture`, so it would need another way to make snapshots, such as a SingleFile-style capture.
- **Screenshots of background tabs.** Today only the visible tab gets one; this would need briefly activating each tab, as an option.
- **Smaller installer.** Most of the size is the bundled Node runtime.
