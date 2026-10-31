import type { ElementFingerprint } from './types.js';

export interface DomAgentOptions {
  cmd: 'fingerprint' | 'collect' | 'sanitize';
  testIdAttribute: string;
  maxElements?: number;
  /** CSS selectors whose content must be redacted before storage/LLM use. */
  redactSelectors?: string[];
  /** Regex sources matched against input name/id/autocomplete/placeholder. */
  maskPatterns?: string[];
  /** Test hook: jsdom has no layout, so visibility checks are skipped in unit tests. */
  assumeVisible?: boolean;
  maxChars?: number;
}

/**
 * Single self-contained function executed INSIDE the page via
 * `elementHandle.evaluate(sentinelDomAgent, opts)`. It must not reference any
 * module-scope identifier: Playwright serializes the function source and runs
 * it in the browser. It is also unit-tested directly against jsdom documents.
 */
export function sentinelDomAgent(el: Element, opts: DomAgentOptions): unknown {
  const MAX_OWN_TEXT = 120;
  const MAX_NAME = 120;
  const MAX_NEARBY = 240;
  const CONTAINER_TEXT_LIMIT = 600;
  const ATTR_WHITELIST = ['type', 'name', 'href', 'placeholder', 'alt', 'title', 'for'];

  const doc = el.ownerDocument;
  const win = doc.defaultView as (Window & typeof globalThis) | null;

  function norm(s: string | null | undefined): string {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function cssEscape(s: string): string {
    if (win && win.CSS && win.CSS.escape) return win.CSS.escape(s);
    return s.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  }

  /** The enclosing document or shadow root: ids and label[for] only resolve inside it. */
  function treeOf(e: Element): Document | ShadowRoot {
    return e.getRootNode() as Document | ShadowRoot;
  }

  /** parentElement stops at a shadow root; this continues through its host. */
  function parentOf(e: Element): Element | null {
    return e.parentElement ?? (treeOf(e) as ShadowRoot).host ?? null;
  }

  /** textContent is empty for a host that renders its text in its shadow tree. */
  function textOf(e: Element): string {
    const light = norm(e.textContent);
    if (light || !e.shadowRoot) return light;
    let text = '';
    const walker = doc.createTreeWalker(e.shadowRoot, 0x4 /* NodeFilter.SHOW_TEXT */);
    while (walker.nextNode()) {
      const tag = walker.currentNode.parentElement?.tagName.toLowerCase();
      if (tag !== 'style' && tag !== 'script') text += ' ' + walker.currentNode.textContent;
    }
    return norm(text);
  }

  /** The document plus every open shadow root below it. Closed roots are out of
   * reach here and for Playwright, so no locator could target them anyway. */
  function allTrees(): Array<Document | ShadowRoot> {
    const trees: Array<Document | ShadowRoot> = [doc];
    for (let i = 0; i < trees.length; i++) {
      const walker = doc.createTreeWalker(trees[i]!, 0x1 /* NodeFilter.SHOW_ELEMENT */);
      while (walker.nextNode()) {
        const shadow = (walker.currentNode as Element).shadowRoot;
        if (shadow) trees.push(shadow);
      }
    }
    return trees;
  }

  function isVisible(e: Element): boolean {
    if (opts.assumeVisible) return true;
    const rect = e.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      // display:contents elements generate no box of their own, so their rect
      // is zero even though their children render — don't drop them (a test id
      // placed on such a wrapper would otherwise vanish from collection).
      if (!win) return false;
      const style = win.getComputedStyle(e);
      return style.display === 'contents' && style.visibility !== 'hidden';
    }
    if (!win) return true;
    const style = win.getComputedStyle(e);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function implicitRole(e: Element): string | null {
    const explicit = e.getAttribute('role');
    if (explicit) return explicit;
    const tag = e.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && e.hasAttribute('href')) return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'option') return 'option';
    if (tag === 'img') return 'img';
    if (tag === 'nav') return 'navigation';
    if (tag === 'main') return 'main';
    if (tag === 'li') return 'listitem';
    if (tag === 'table') return 'table';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'input') {
      const type = (e.getAttribute('type') || 'text').toLowerCase();
      if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image')
        return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (type === 'search') return 'searchbox';
      if (type === 'hidden') return null;
      return 'textbox';
    }
    return null;
  }

  function labelTextFor(e: Element): string {
    const tag = e.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return '';
    const id = e.getAttribute('id');
    if (id) {
      const label = treeOf(e).querySelector('label[for="' + cssEscape(id) + '"]');
      if (label) return norm(label.textContent);
    }
    const wrapping = e.closest('label');
    if (wrapping) return norm(wrapping.textContent);
    return '';
  }

  function ownText(e: Element): string {
    const full = textOf(e);
    if (full.length === 0) return '';
    // Containers that aggregate lots of text are not "own" text.
    if (full.length > 160) {
      let direct = '';
      for (const node of Array.from(e.childNodes)) {
        if (node.nodeType === 3 /* TEXT_NODE */) direct += ' ' + (node.textContent || '');
      }
      return norm(direct).slice(0, MAX_OWN_TEXT);
    }
    return full.slice(0, MAX_OWN_TEXT);
  }

  function accessibleName(e: Element): string {
    const ariaLabel = e.getAttribute('aria-label');
    if (ariaLabel) return norm(ariaLabel).slice(0, MAX_NAME);
    const labelledBy = e.getAttribute('aria-labelledby');
    if (labelledBy) {
      const txt = labelledBy
        .split(/\s+/)
        .map((id) => {
          const ref = treeOf(e).getElementById(id);
          return ref ? norm(ref.textContent) : '';
        })
        .filter(Boolean)
        .join(' ');
      if (txt) return txt.slice(0, MAX_NAME);
    }
    const label = labelTextFor(e);
    if (label) return label.slice(0, MAX_NAME);
    const alt = e.getAttribute('alt');
    if (alt) return norm(alt).slice(0, MAX_NAME);
    const tag = e.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (e.getAttribute('type') || '').toLowerCase();
      if (type === 'submit' || type === 'button') {
        const v = e.getAttribute('value');
        if (v) return norm(v).slice(0, MAX_NAME);
      }
    }
    const text = ownText(e);
    if (text) return text.slice(0, MAX_NAME);
    const placeholder = e.getAttribute('placeholder');
    if (placeholder) return norm(placeholder).slice(0, MAX_NAME);
    const title = e.getAttribute('title');
    if (title) return norm(title).slice(0, MAX_NAME);
    return '';
  }

  function nearbyText(e: Element): string {
    // Prefer the NEAREST container with meaningful text: sibling widgets (e.g.
    // per-product "Add to cart" buttons) are disambiguated by their own card's
    // text, not by a shared page-level ancestor that looks identical for all.
    // A wrapper repeating the text below it adds nothing, so it doesn't spend a
    // level: components nest several, and the card text sits just past them.
    const own = textOf(e);
    let fallback = '';
    let previous = own;
    let levels = 0;
    let cur = parentOf(e);
    while (levels < 3 && cur && cur !== doc.body) {
      const t = textOf(cur);
      if (t.length > CONTAINER_TEXT_LIMIT) break;
      if (t !== previous) {
        levels++;
        previous = t;
        if (!fallback && t.length > 0) fallback = t;
        if (t.length >= 20 && t.length <= 300) return t.slice(0, MAX_NEARBY);
      }
      cur = parentOf(cur);
    }
    return (fallback || own).slice(0, MAX_NEARBY);
  }

  function cssPath(e: Element): string {
    const segments: string[] = [];
    let cur: Element | null = e;
    while (cur && cur !== doc.body && cur !== doc.documentElement) {
      const tag = cur.tagName.toLowerCase();
      let nth = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) nth++;
        sib = sib.previousElementSibling;
      }
      segments.unshift(tag + ':nth-of-type(' + nth + ')');
      // Playwright's CSS treats a host's shadow children as its children.
      cur = parentOf(cur);
    }
    return 'body > ' + segments.join(' > ');
  }

  function fingerprintOf(e: Element): Record<string, unknown> {
    const attributes: Record<string, string> = {};
    for (const a of ATTR_WHITELIST) {
      const v = e.getAttribute(a);
      if (v) attributes[a] = norm(v).slice(0, 200);
    }
    return {
      tag: e.tagName.toLowerCase(),
      role: implicitRole(e),
      name: accessibleName(e),
      text: ownText(e),
      id: e.getAttribute('id'),
      testId: e.getAttribute(opts.testIdAttribute),
      classes: Array.from(e.classList).slice(0, 12),
      attributes,
      nearbyText: nearbyText(e),
      labelText: labelTextFor(e),
      cssPath: cssPath(e),
    };
  }

  if (opts.cmd === 'fingerprint') {
    return fingerprintOf(el);
  }

  if (opts.cmd === 'collect') {
    const max = opts.maxElements || 300;
    const interactiveSelector =
      'button, a[href], input, select, textarea, [role], [onclick], [tabindex], [' +
      opts.testIdAttribute +
      '], h1, h2, h3, h4, h5, h6';
    const seen = new Set<Element>();
    const out: Record<string, unknown>[] = [];
    const trees = allTrees();
    for (const tree of trees) {
      for (const e of Array.from(tree.querySelectorAll(interactiveSelector))) {
        if (out.length >= max) break;
        if (seen.has(e) || !isVisible(e)) continue;
        if (e.tagName.toLowerCase() === 'input' && (e.getAttribute('type') || '') === 'hidden')
          continue;
        seen.add(e);
        out.push(fingerprintOf(e));
      }
    }
    // Text-bearing leaves: assertion targets (messages, prices, statuses).
    // TreeWalker instead of querySelectorAll('*'): on large SPAs the latter
    // materializes the entire DOM as one array; the walker visits nodes lazily
    // and stops as soon as the element budget is reached.
    for (const tree of trees) {
      const walker = doc.createTreeWalker(
        tree === doc ? doc.body : tree,
        0x1 /* NodeFilter.SHOW_ELEMENT */,
      );
      while (out.length < max) {
        const node = walker.nextNode();
        if (!node) break;
        const e = node as Element;
        if (seen.has(e)) continue;
        if (e.childElementCount > 0) continue;
        const tag = e.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;
        const text = norm(e.textContent);
        if (text.length === 0 || text.length > 200) continue;
        if (!isVisible(e)) continue;
        seen.add(e);
        out.push(fingerprintOf(e));
      }
    }
    return out;
  }

  if (opts.cmd === 'sanitize') {
    const clone = doc.documentElement.cloneNode(true) as Element;
    for (const bad of Array.from(clone.querySelectorAll('script, style, link, noscript, svg'))) {
      bad.remove();
    }
    // Strip authored input values; runtime .value never serializes, but be thorough.
    for (const input of Array.from(clone.querySelectorAll('input, textarea'))) {
      input.removeAttribute('value');
      if (input.tagName.toLowerCase() === 'textarea') input.textContent = '';
    }
    const patterns = (opts.maskPatterns || []).map((p) => new RegExp(p, 'i'));
    for (const input of Array.from(clone.querySelectorAll('input, textarea, select'))) {
      const hay = [
        input.getAttribute('name'),
        input.getAttribute('id'),
        input.getAttribute('autocomplete'),
        input.getAttribute('placeholder'),
        input.getAttribute('type'),
      ]
        .filter(Boolean)
        .join(' ');
      const isPassword = (input.getAttribute('type') || '').toLowerCase() === 'password';
      if (isPassword || patterns.some((p) => p.test(hay))) {
        input.setAttribute('data-sentinel-redacted', 'true');
        input.removeAttribute('placeholder');
      }
    }
    for (const sel of opts.redactSelectors || []) {
      let matches: Element[] = [];
      try {
        matches = Array.from(clone.querySelectorAll(sel));
      } catch {
        // invalid selector in config — ignore here, config validation warns
      }
      for (const m of matches) {
        m.textContent = '[REDACTED]';
        m.setAttribute('data-sentinel-redacted', 'true');
      }
    }
    let html = clone.outerHTML;
    const cap = opts.maxChars || 500_000;
    if (html.length > cap) html = html.slice(0, cap) + '<!-- sentinel: truncated -->';
    return html;
  }

  throw new Error('sentinelDomAgent: unknown cmd ' + String(opts.cmd));
}

/** Typed helpers so call sites don't cast. */
export type CollectResult = ElementFingerprint[];
export type FingerprintResult = ElementFingerprint;
export type SanitizeResult = string;
