# Store submission: Chrome Web Store and Edge Add-ons

Everything to paste into the developer dashboards. The upload is `dist\tabloft-extension-<version>.zip`, built by `build\package-extension.ps1`. Images are in `store\images\`.

- **Chrome Web Store:** <https://chrome.google.com/webstore/devconsole> (one-time $5 developer registration). Brave installs from the Chrome Web Store too.
- **Edge Add-ons:** <https://partner.microsoft.com/dashboard/microsoftedge> (free registration).

---

## Store listing

**Name:** TabLoft

**Summary** (132 characters max; the same as the manifest description)
> Save tabs with a full offline snapshot to the TabLoft desktop app, then close them without fear. Needs the free TabLoft app.

**Category:** Productivity (Chrome: "Workflow & Planning"; Edge: "Productivity")

**Language:** English

**Description**
```
Hundreds of open tabs, each one a research thread, an interesting idea or something to read later. Closing them feels like losing them, so they pile up and nothing can be found.

TabLoft gives every tab a safe home outside the browser, so you can close it without worrying.

• One click saves this tab, the selected tabs, the whole window or every window
• Each tab is stored twice: the link, plus a full offline snapshot of the page as you saw it (including pages you're signed in to), a screenshot and the page text
• Tabs are only closed after they're safely stored; if a save fails, the tab stays open
• Cookie banners are hidden in snapshots, so you see the page, not the pop-up
• Organise later in the TabLoft library: an Inbox to sort, collections, tags, starring, archive, and full-text search across every page you've saved
• Works across Chrome, Brave and Edge, all saving into the same library
• Keyboard shortcuts: Alt+Shift+S saves the current tab, Alt+Shift+X saves and closes it; right-click a link to save it without opening it

PRIVATE BY DESIGN
Everything stays on your own computer. No account, no cloud, no tracking. The extension sends saved pages only to the TabLoft app on the same computer.

REQUIRES THE FREE TABLOFT DESKTOP APP (WINDOWS)
Your library lives in the TabLoft desktop app, so it is independent of any browser and survives clearing browser data. Download it free from https://github.com/TorJensen/tabloft/releases/latest. If the app isn't running, the extension tells you, and nothing is saved or closed.

Free and open source: https://github.com/TorJensen/tabloft
```

**Homepage / website:** https://github.com/TorJensen/tabloft
**Support URL:** https://github.com/TorJensen/tabloft/issues
**Privacy policy URL:** https://github.com/TorJensen/tabloft/blob/main/PRIVACY.md

**Images** (`store\images\`)
| File | Size | Used for |
|---|---|---|
| `icon-128.png` | 128×128 | Store icon (same as `extension/icons/128.png`) |
| `screenshot-1-library.png` | 1280×800 | Screenshot: the library |
| `screenshot-2-popup.png` | 1280×800 | Screenshot: saving tabs from the popup |
| `screenshot-3-snapshot.png` | 1280×800 | Screenshot: an offline snapshot |
| `promo-small-440x280.png` | 440×280 | Small promo tile |

---

## Privacy practices tab (Chrome) / Properties (Edge)

**Single purpose**
> TabLoft saves the browser tabs the user chooses (link, offline snapshot, screenshot and text) to the TabLoft desktop app on the same computer, so the user can close the tabs and find the pages again later.

**Permission justifications**

| Permission | Justification |
|---|---|
| `tabs` | Lists the user's open tabs so they can save the current tab, selected tabs, a window or all windows, reads each tab's URL and title, and closes tabs after they have been saved. |
| `pageCapture` | Creates the offline snapshot (MHTML) of each page the user saves. This is the core feature. |
| `scripting` | Runs a short script in a tab only when the user saves it: it reads the page's title, description and visible text for search, and temporarily hides cookie-consent banners so they don't cover the snapshot (restored straight afterwards). |
| Host permission `<all_urls>` | The user can save any web page, including several tabs at once from a window; the extension must be able to capture and read whichever pages the user chooses to save, and to screenshot the visible tab. It does nothing on pages the user hasn't asked to save. |
| `contextMenus` | Adds "Save tab to TabLoft", "Save and close" and "Save link to TabLoft" to the right-click menu. |
| `storage` | Stores the extension's own settings (e.g. "close tabs after saving"). |
| `notifications` | Tells the user when a save didn't happen because the TabLoft desktop app isn't running. |
| `alarms` | Periodically checks whether the locally installed TabLoft app has a newer version of the extension files (only relevant for copies installed from the app folder). |

**Remote code:** No, I am not using remote code. All code is included in the package.

**Data usage** (Chrome asks which categories the extension collects or handles. Data never leaves the user's computer, but the extension does handle these, so declare them honestly):
- ☑ **Web history**: the URL and title of the pages the user chooses to save.
- ☑ **Website content**: text, images and the snapshot of the pages the user chooses to save.
- All other categories: not collected.

Certify all three statements:
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Note for reviewers** (Chrome: "Additional information" / Edge: "Notes for certification")
```
TabLoft works together with a free open-source Windows desktop app that stores the user's library locally (https://github.com/TorJensen/tabloft/releases/latest). The extension sends saved pages only to that app at http://127.0.0.1:7878 on the same computer. Without the app running, the popup explains that the app needs to be opened and nothing is saved.

To test: install TabLoft-Setup-<version>.exe from the releases page, then click the TabLoft toolbar button on any page and choose "Save this tab". The saved page appears in the library at http://127.0.0.1:7878.
```
