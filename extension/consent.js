// Hides cookie-consent banners while a tab is captured, then puts them back, so
// snapshots, screenshots and searchable text show the page rather than the banner.
// The live tab is restored right after capture (no consent is given or refused).

// Keep in sync with server/consent.js.
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

// Runs inside the page (chrome.scripting.executeScript). Must be self-contained.
export function hideConsentInPage(selectors) {
  const hidden = [];
  const hide = el => {
    if (!el || el.dataset.tabmindHidden || el === document.body || el === document.documentElement) return;
    hidden.push([el, el.style.getPropertyValue('display'), el.style.getPropertyPriority('display')]);
    el.dataset.tabmindHidden = '1';
    el.style.setProperty('display', 'none', 'important');
  };

  // 1. Known consent platforms.
  for (const sel of selectors) {
    try { document.querySelectorAll(sel).forEach(hide); } catch {}
  }
  // 2. Consent iframes (Sourcepoint, IAB TCF vendors, ...).
  document.querySelectorAll('iframe').forEach(f => {
    if (/consensu\.org|privacy-mgmt\.com|sourcepoint|cookiebot|onetrust|trustarc|consentmanager|cmp\./i.test(f.src || '')) {
      let el = f;
      while (el.parentElement && el.parentElement !== document.body && getComputedStyle(el).position !== 'fixed') el = el.parentElement;
      hide(el);
    }
  });
  // 3. Hand-rolled banners: fixed/sticky or modal elements that talk about cookies AND offer to accept/reject.
  const topic = /cookie|consent|gdpr|samtykke|einwilligung|consentement|consenso|toestemming|zgod|privacy (settings|preferences|choices)/i;
  const action = /\b(accept|agree|allow|reject|decline|refuse|got it|ok|okay|i understand|manage|preferences|customi[sz]e|godkend|accepter|tillad|afvis|akzeptieren|zustimmen|ablehnen|alle|aceptar|rechazar|accetta|rifiuta|accepteren|weigeren|refuser)\b/i;
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[data-tabmind-hidden]')) continue;
    const cs = getComputedStyle(el);
    const modal = el.getAttribute('role') === 'dialog' || el.getAttribute('role') === 'alertdialog' || el.getAttribute('aria-modal') === 'true';
    if (cs.position !== 'fixed' && cs.position !== 'sticky' && !modal) continue;
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.querySelector('main, article, h1')) continue;           // a page header/layout, not a banner
    const text = (el.innerText || '').slice(0, 8000);
    if (text.length < 30 || text.length > 7000) continue;
    if (topic.test(text) && action.test(text) && el.querySelector('button, a, [role="button"], input[type="button"], input[type="submit"]')) hide(el);
  }
  // 4. Once a banner is gone, also drop the dark full-screen backdrop it used.
  if (hidden.length) {
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('[data-tabmind-hidden]')) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      const covers = r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
      if (covers && (el.innerText || '').trim().length < 20 && Number(cs.zIndex) >= 100) hide(el);
    }
  }
  // 5. Consent dialogs lock scrolling; unlock it for the capture.
  const unlocked = [];
  if (hidden.length) {
    for (const el of [document.documentElement, document.body]) {
      const cs = getComputedStyle(el);
      if (cs.overflow.includes('hidden') || cs.overflowY === 'hidden' || cs.position === 'fixed') {
        unlocked.push([el, el.getAttribute('style')]);
        el.style.setProperty('overflow', 'visible', 'important');
        if (cs.position === 'fixed') el.style.setProperty('position', 'static', 'important');
      }
    }
  }

  window.__tabmindRestore = () => {
    for (const [el, value, prio] of hidden) {
      delete el.dataset.tabmindHidden;
      if (value) el.style.setProperty('display', value, prio); else el.style.removeProperty('display');
    }
    for (const [el, style] of unlocked) {
      if (style === null) el.removeAttribute('style'); else el.setAttribute('style', style);
    }
    delete window.__tabmindRestore;
  };
  return hidden.length;
}

export function restoreConsentInPage() {
  if (window.__tabmindRestore) window.__tabmindRestore();
}
