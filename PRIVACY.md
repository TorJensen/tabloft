# TabLoft privacy policy

*Last updated: 14 October 2026*

TabLoft is a free, open-source tool made of two parts: a browser extension (for Chrome, Brave and Edge) and a desktop app for Windows. This policy covers both.

## The short version

**Everything TabLoft saves stays on your own computer.** TabLoft has no servers, no accounts, no analytics, no tracking and no ads. Nothing you save is sent to the developer or to anyone else.

## What the extension handles, and where it goes

When **you** choose to save a tab (with the toolbar button, the keyboard shortcut or the right-click menu), the extension reads that page and sends the result **only to the TabLoft desktop app running on the same computer** (at `http://127.0.0.1`, an address that cannot be reached from outside your computer). It sends:

- the page address (URL), title, description and icon;
- a snapshot of the page (an MHTML file, the same format the browser uses for "Save page as");
- a screenshot of the visible part of the page, if the tab is on screen;
- the visible text of the page, so you can search your saved pages later.

While capturing, the extension temporarily hides cookie-consent banners on the page so they don't cover the snapshot. It puts them back straight afterwards. It never accepts or rejects consent on your behalf.

The extension does **not** read pages you don't ask it to save, does not run in the background on the sites you visit, and does not collect browsing history.

The extension stores its own settings (such as "close tabs after saving") in the browser's extension storage.

## What the desktop app stores

The app keeps your library in a folder on your computer (`%LOCALAPPDATA%\TabLoft`). You can open it from the tray menu, back it up, or delete it at any time. Uninstalling TabLoft asks whether to delete the library as well.

## Network connections

- The extension talks only to the TabLoft app on your own computer.
- The desktop app checks GitHub (`api.github.com` and `github.com`) for new TabLoft versions, shortly after it starts and twice a day. This request contains no information about you or your library beyond what any web request contains (your IP address, seen by GitHub). You can switch it off in the tray menu ("Check for updates automatically").
- When you browse your library, site icons and preview images, and any images that weren't captured in a snapshot, may load from the original websites, like any web page would.

## Sharing and selling

TabLoft does not sell, share or transfer any data. There is nothing to share, since nothing leaves your computer.

## Contact

Questions or concerns: open an issue at <https://github.com/TorJensen/tabloft/issues>.
