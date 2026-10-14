// Cookie-consent banners and their backdrops, from the common consent platforms
// (Cookiebot, OneTrust, Didomi, Quantcast, TrustArc, Usercentrics, Sourcepoint,
// Google Funding Choices, Osano, Complianz, CookieYes, iubenda, Borlabs, consentmanager,
// Klaro, Axeptio, tarteaucitron, Termly, ...) plus common hand-rolled ids/classes.
// Keep in sync with extension/consent.js.
export const CONSENT_SELECTORS = [
  '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay', '#CookiebotWidget',
  '#onetrust-consent-sdk', '#onetrust-banner-sdk', '.onetrust-pc-dark-filter', '#ot-sdk-btn-floating',
  '#didomi-host', '#didomi-notice', '.didomi-popup-backdrop',
  '#qc-cmp2-container', '.qc-cmp2-container', '#qcCmpUi',
  '#truste-consent-track', '#truste-consent-content', '.truste_overlay', '.truste_box_overlay', '#consent_blackbar',
  '#usercentrics-root', '#usercentrics-cmp-ui', '#uc-banner-modal',
  '[id^="sp_message_container"]', '.sp_veil',
  '.fc-consent-root', '.fc-dialog-overlay',
  '.osano-cm-window', '.osano-cm-dialog',
  '#cmplz-cookiebanner-container', '.cmplz-cookiebanner',
  '.cky-consent-container', '.cky-overlay', '.cky-modal', '.cky-btn-revisit-wrapper',
  '#iubenda-cs-banner', '.iubenda-cs-container',
  '#BorlabsCookieBox', '#BorlabsCookieWidget',
  '#cmpbox', '#cmpbox2', '.cmpboxBG',
  '#klaro', '.klaro .cookie-notice', '.klaro .cookie-modal',
  '#axeptio_overlay', '#tarteaucitronRoot', '#termly-code-snippet-support',
  '#cookie-law-info-bar', '.cli-modal-backdrop', '#moove_gdpr_cookie_info_bar', '#gdpr-cookie-message',
  '.cc-window', '.cc-banner', '.cc-revoke', '#cc-main', '#cookiescript_injected',
  '#_evidon_banner', '.evidon-banner', '#hs-eu-cookie-confirmation',
  '[data-testid="consent-banner"]', '[data-testid="cookie-banner"]', '[aria-label="Cookie banner"]',
  '#consent-banner', '.consent-banner', '#cookie-banner', '.cookie-banner', '#cookieBanner',
  '#cookie-consent', '.cookie-consent', '#cookieConsent', '#cookie-notice', '.cookie-notice',
  '#cookie-bar', '.cookie-bar', '#gdpr-banner', '.gdpr-banner',
];

// Content that scroll-reveal animations (GSAP, Framer Motion, AOS...) had not faded in yet
// when the page was captured: scripts don't run in snapshots, so it would stay invisible.
// Menus, dialogs and tooltips are left alone - they are meant to stay hidden.
const NOT_UI = ':not(:is(nav, header, [role="menu"], [role="menubar"], [role="dialog"], [role="tooltip"], [role="listbox"], [aria-hidden="true"]))';
const NOT_IN_UI = ':not(:is(nav, header, [role="menu"], [role="menubar"], [role="dialog"], [role="tooltip"], [role="listbox"], [aria-hidden="true"]) *)';
const REVEAL = ['[style*="opacity: 0;"]', '[style*="opacity:0;"]', '[style$="opacity: 0"]', '[style$="opacity:0"]', '[data-aos]']
  .map(s => `body ${s}${NOT_UI}${NOT_IN_UI}`);

// CSS injected into snapshots when they are viewed (unless "show original" is chosen).
export const CONSENT_CSS =
  `${CONSENT_SELECTORS.join(',\n')} { display: none !important; }\n` +
  // Consent dialogs usually lock scrolling and blur the page while open.
  `html, body { overflow-y: auto !important; }\n` +
  `body.didomi-popup-open, body.sp-message-open, body.cmp-open, body.modal-open, html.sp-message-open { overflow: auto !important; position: static !important; }\n` +
  `${REVEAL.join(',\n')} { opacity: 1 !important; transform: none !important; }\n`;
