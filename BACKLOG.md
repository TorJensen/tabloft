# TabMind backlog

## Next

- **Desktop installer.** The goal is one `TabMind-Setup.exe` with no Node.js prerequisite and no scripts to run.
  - Bundle the server, with its own Node runtime and the `ui/` files, into a single `tabmind.exe` (Node single-executable application).
  - Add a tray icon: open library, pause, quit.
  - Build a per-user installer that needs no admin rights (Inno Setup): Start Menu entry, autostart, Add/Remove Programs entry, and an uninstaller that keeps the library by default.
  - Keep the extension "load unpacked" step until it's published to the Chrome Web Store and Edge Add-ons; that also removes the developer-mode warning.

## Later

- **Sync between computers.** A shared library across PCs, either through a home server or NAS, or export/import between machines. Don't share the SQLite file through OneDrive or Dropbox, because it can corrupt.
- **Snapshot history.** Keep earlier snapshots when a page is saved again, instead of replacing them.
- **Auto-suggested tags and collections** based on page content.
- **Resurface.** A weekly "you saved these and never looked" view of the Inbox.
- **Firefox support.** Firefox has no `pageCapture`, so it would need another way to make snapshots, such as a SingleFile-style capture.
- **Screenshots of background tabs.** Today only the visible tab gets one; this would need briefly activating each tab, as an option.
