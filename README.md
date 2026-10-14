# TabMind

**Close your tabs without losing anything.**

Hundreds of open tabs are usually research threads, interesting ideas and things to read later. Closing them feels like losing them, so nothing gets closed and nothing can be found. TabMind gives every tab a safe home outside the browser:

- **One click sends tabs to TabMind**: this tab, selected tabs, the whole window, or every window. It works from Chrome, Brave and Edge.
- **Each tab is stored twice.** You get the **link** plus a **snapshot** of the page as it looked: a full offline copy (MHTML), a screenshot of the visible tab, and the page text so you can search it.
- **Tabs close only after they're safely stored.** If a save fails, that tab stays open.
- **Organize later in the library.** Everything lands in the **Inbox**. From there you can triage into **Collections** and **Tags**, keep items in the **Library**, or **Archive** what you've finished. Full-text search covers every page you ever saved.

Everything lives on your own computer. There is no cloud and no account.

---

## Install

1. **Get TabMind.** Run `git clone https://github.com/TorJensen/tabmind.git` in the folder where you want it, or download the ZIP from GitHub and unzip it. Any folder works, for example `C:\TabMind`.
2. **Double-click `install.cmd`.** The installer:
   - checks for [Node.js](https://nodejs.org) 22.13+ and offers to install it with winget if it's missing;
   - adds **Start Menu > TabMind > TabMind Library** and starts TabMind silently at every login;
   - starts TabMind and opens the Extensions page of each browser it finds (Chrome, Brave, Edge), with the extension folder path already copied to your clipboard.
3. **In each browser**, turn on **Developer mode**, click **Load unpacked**, paste the path (Ctrl+V) and click **Select Folder**. Then pin the TabMind icon to the toolbar.

All browsers save into the same library, and each item records which browser it came from.

| Script | What it does |
|---|---|
| `install.cmd` | Installs TabMind. Running it again repairs or reinstalls it. Options: `-NoAutostart`, `-NoBrowserSetup`, `-Yes` |
| `update.cmd` | Pulls the latest version from GitHub and restarts TabMind. Your library is not touched |
| `uninstall.cmd` | Removes the shortcuts and autostart. It asks before deleting your library and keeps it by default |
| `start-tabmind.cmd` | Runs the server in a visible window, which is useful for seeing errors |

After an update that changes the extension, click the reload arrow on the TabMind card on each browser's Extensions page.

---

## Daily use

| To… | Do this |
|---|---|
| Save the current tab | Click the TabMind icon → **Save this tab**, or press `Alt+Shift+S` |
| Save and close the current tab | `Alt+Shift+X`, or right-click the page → *Save tab to TabMind and close* |
| Clear out a whole window | TabMind icon → **Save this window** (with "Close tabs after saving" ticked) |
| Declare tab bankruptcy | TabMind icon → **Save all windows** |
| Save a link without opening it | Right-click the link → *Save link to TabMind* |
| Add context while saving | Open **Tags, collection, note** in the popup before you click save |

**Sleeping tabs.** Browsers unload background tabs to save memory, and an unloaded tab can't be snapshotted. By default TabMind briefly reloads those tabs so it can capture them. You can turn this off in the popup's **Settings**; sleeping tabs are then saved as links only.

**Pinned tabs** are saved but never closed in bulk saves. If the save would close every window, TabMind opens the library first so the browser doesn't quit.

### The library (<http://127.0.0.1:7878>)

- **Inbox**: everything you've saved and not yet sorted.
- **Library**: things you've decided to keep. **Archive**: things you've read or finished with.
- **Collections**: one per project or research thread. **Tags**: any cross-cutting labels.
- **Sites** and **Browsers**: automatic groupings.
- Click a card to open it. You can view the offline **Snapshot**, the **Screenshot**, or the extracted **Text**, and edit the title, notes, tags and collection.
- To select several items, hover a card and tick its box (or Ctrl-click). You can then tag them, move them to a collection, keep, archive, open live or delete them in bulk.

**Keyboard shortcuts:**
- `/` search
- `j` / `k` next / previous item
- `e` archive and move to the next item (fast Inbox triage)
- `s` star
- `o` open the live page
- `Esc` close

---

## Where your data is

Your library is kept separate from the program, so updating or reinstalling never touches it:

```
%LOCALAPPDATA%\TabMind\       (e.g. C:\Users\you\AppData\Local\TabMind)
  tabmind.db        SQLite database: links, titles, notes, tags, collections, page text
  snapshots\*.mhtml full offline copies of pages (also open directly in Chrome/Edge)
  screens\*.jpg     screenshots
```

To **back up**, copy that folder while TabMind is stopped. To keep the library somewhere else, set the environment variable `TABMIND_DATA` to that folder. Don't put it in a OneDrive or Dropbox folder that two computers use at once (see [BACKLOG.md](BACKLOG.md) for proper sync).

## How it works

```
 Chrome / Brave / Edge                    TabMind server (Node, 127.0.0.1:7878)
 ┌───────────────────────┐   link, text,   ┌──────────────────────────────────┐
 │ TabMind extension     │  screenshot ──► │ SQLite + full-text search (FTS5) │
 │  pageCapture → MHTML  │  MHTML ───────► │ data/snapshots, data/screens     │
 └───────────────────────┘                 │ Library web app  (ui/)           │
                                           └──────────────────────────────────┘
```

- `extension/`: a Manifest V3 extension. The same code runs in every Chromium browser.
- `server/server.js`: the HTTP API and static file server. It only listens on localhost, and it rejects requests from websites and from other host names (DNS rebinding).
- `server/mhtml.js`: renders stored MHTML snapshots in the library. Pages are shown in a sandbox with scripts disabled.
- `ui/`: the library app, written in vanilla JS with no build step.

## Known limitations (v0.1)

- **Screenshots:** only the tab that is visible in its window gets a screenshot. Browsers can't screenshot background tabs. Every saved tab still gets a full MHTML snapshot.
- **Missing fonts and images:** fonts or lazy-loaded images that the page hadn't loaded yet aren't in the snapshot. The snapshot then uses fallback fonts, and it loads missing images from the live site if that site is still online.
- **Re-saving a page:** saving the same URL again refreshes its snapshot instead of keeping a history of versions.
- **Firefox:** not supported yet. It doesn't have the `pageCapture` API.
