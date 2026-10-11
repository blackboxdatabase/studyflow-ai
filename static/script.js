/* ==========================================================================
   StudyFlow AI — client application
   Vanilla JavaScript. Talks to the Flask backend through POST /api/chat
   using {"message": "..."} and expects {"answer": "..."} in return.
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const root = document.documentElement;

  const mqMobile = window.matchMedia('(max-width: 899px)');
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mqCoarse = window.matchMedia('(pointer: coarse)');

  const API_URL = '/api/chat';
  const REQUEST_TIMEOUT_MS = 120000;
  const MAX_CONVERSATIONS = 60;

  const KEY = {
    convs: 'studyflow.conversations',
    active: 'studyflow.active',
    saved: 'studyflow.saved',
    name: 'studyflow.name',
    sidebar: 'studyflow.sidebar',
    theme: 'studyflow-theme',
  };

  const uid = () =>
    (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  const storage = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
    },
    getRaw(key) { try { return localStorage.getItem(key); } catch { return null; } },
    setRaw(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
  };

  /** Create an element. Text is always assigned as text, never as HTML. */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'i');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function setIcon(button, name) {
    const use = $('use', button);
    if (use) use.setAttribute('href', '#i-' + name);
  }

  /* ------------------------------------------------------------------------
     Markdown → safe HTML
     Everything is escaped first; only elements generated here are emitted,
     and the result is passed through an allow-list sanitiser before it is
     ever attached to the page. Raw HTML in a response is shown as text.
     ------------------------------------------------------------------------ */
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ---- Formula helper (readable approximation of common LaTeX) ---- */
  const GREEK = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ',
    pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
  };
  const SYMBOLS = {
    times: '×', cdot: '·', div: '÷', pm: '±', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
    approx: '≈', infty: '∞', sum: '∑', prod: '∏', int: '∫', rightarrow: '→', to: '→', Rightarrow: '⇒',
    leftarrow: '←', partial: '∂', nabla: '∇', in: '∈', subset: '⊂', cup: '∪', cap: '∩', forall: '∀',
    exists: '∃', ldots: '…', dots: '…', cdots: '⋯', circ: '°', propto: '∝', equiv: '≡',
    log: 'log', ln: 'ln', sin: 'sin', cos: 'cos', tan: 'tan', lim: 'lim', max: 'max', min: 'min',
  };

  function mathHtml(tex) {
    let s = esc(String(tex).trim());
    for (let n = 0; n < 3; n++) {
      s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
        '<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>');
    }
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)').replace(/\\sqrt\s*(\w)/g, '√$1');
    s = s.replace(/\\(?:text|textbf|textit|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}/g, '$1');
    s = s.replace(/\\(?:left|right)\s*([()[\]|.]?)/g, (m, d) => (d === '.' ? '' : d));
    s = s.replace(/\\([A-Za-z]+)/g, (m, name) => GREEK[name] || SYMBOLS[name] || m);
    s = s.replace(/\\[,;: ]/g, ' ').replace(/\\([{}%$#&_])/g, '$1');
    s = s.replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>').replace(/\^([A-Za-z0-9]|[-+]\d+)/g, '<sup>$1</sup>');
    s = s.replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>').replace(/_([A-Za-z0-9])/g, '<sub>$1</sub>');
    return s.replace(/[{}]/g, '');
  }

  /* ---- Lightweight syntax highlighter ---- */
  const HASH_LANGS = new Set(['python', 'py', 'bash', 'sh', 'shell', 'zsh', 'yaml', 'yml', 'ruby', 'rb', 'r', 'toml', 'perl', 'dockerfile', 'makefile', 'powershell', 'ps1']);
  const DASH_LANGS = new Set(['sql', 'lua', 'haskell', 'hs']);
  const PLAIN_LANGS = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'output', 'console', 'log', 'markdown', 'md', 'diff']);
  const KEYWORDS = new Set(('abstract and as assert async await begin bool boolean break case catch char class const continue def default del delete do double elif else end enum except export extends ' +
    'False false final finally float for from func function global goto if impl implements import in include instanceof int interface is lambda let long match mod namespace new nil None not null of ' +
    'or package pass private protected pub public raise return select self set short signed static string struct super switch template then this throw True true try type typedef typeof union unsigned ' +
    'use using var void volatile when where while with yield insert update create table values from join group order by limit').split(' '));

  const R_STR = /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/.source;
  const R_NUM = /\b\d[\d_]*(?:\.\d+)?\b/.source;
  const R_ID = /[A-Za-z_$][\w$]*/.source;
  const R_COMMENT = {
    hash: /#[^\n]*/.source,
    dash: /--[^\n]*/.source,
    slash: /\/\/[^\n]*|\/\*[\s\S]*?\*\//.source,
  };
  const tokenCache = {};
  function tokenRegex(lang) {
    const kind = HASH_LANGS.has(lang) ? 'hash' : DASH_LANGS.has(lang) ? 'dash' : 'slash';
    return tokenCache[kind] || (tokenCache[kind] = new RegExp(`(${R_COMMENT[kind]})|(${R_STR})|(${R_NUM})|(${R_ID})`, 'g'));
  }

  function highlight(code, lang) {
    if (PLAIN_LANGS.has(lang)) return esc(code);
    const re = tokenRegex(lang);
    re.lastIndex = 0;
    let out = '', last = 0, m;
    while ((m = re.exec(code)) !== null) {
      out += esc(code.slice(last, m.index));
      const text = m[0];
      let cls = null;
      if (m[1] !== undefined) cls = 'c';
      else if (m[2] !== undefined) cls = 's';
      else if (m[3] !== undefined) cls = 'n';
      else if (m[4] !== undefined) {
        if (KEYWORDS.has(text)) cls = 'k';
        else if (code[re.lastIndex] === '(') cls = 'f';
      }
      out += cls ? `<span class="tok-${cls}">${esc(text)}</span>` : esc(text);
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  function codeBlock(code, lang) {
    const l = (lang || '').toLowerCase();
    return '<div class="code-block"><div class="code-head">' +
      `<span class="code-lang">${esc(l || 'code')}</span>` +
      '<button type="button" class="code-copy" data-copy-code aria-label="Copy code">Copy</button></div>' +
      `<pre tabindex="0"><code>${highlight(code, l)}</code></pre></div>`;
  }

  /* ---- Inline formatting ---- */
  function emphasis(s) {
    return s
      .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
      .replace(/\*(?=[^\s*])([^*\n]*?[^\s*])\*/g, '<em>$1</em>')
      .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  }

  const SAFE_URL = /^(https?:\/\/|mailto:)/i;

  function inline(src) {
    const stash = [];
    const put = (html) => { stash.push(html); return `\u0000${stash.length - 1}\u0000`; };
    let s = String(src).replace(/\u0000/g, '');

    // Code spans first so nothing inside them is interpreted.
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m, t, c) => put(`<code>${esc(c.trim())}</code>`));

    // Formulas: \( … \), $$ … $$ and $ … $ (guarded against prices like "$5 and $10").
    s = s.replace(/\\\(([\s\S]+?)\\\)/g, (m, t) => put(`<span class="math">${mathHtml(t)}</span>`));
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m, t) => put(`<span class="math">${mathHtml(t)}</span>`));
    s = s.replace(/(^|[^\\$\w])\$(?=\S)([^$\n]*?[^\s$\\])\$(?![\w$])/g,
      (m, pre, t) => pre + put(`<span class="math">${mathHtml(t)}</span>`));

    s = esc(s);

    // Images are never loaded; show their alt text instead.
    s = s.replace(/!\[([^\]\n]*)\]\(([^)\s]*)[^)]*\)/g, (m, alt) => alt);

    // Links: only http(s) and mailto are ever linked.
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+&quot;[^)]*?&quot;)?\)/g, (m, label, url) => {
      const raw = url.replace(/&amp;/g, '&');
      if (!SAFE_URL.test(raw)) return label;
      return put(`<a href="${url}" target="_blank" rel="noopener noreferrer">${emphasis(label)}</a>`);
    });

    // Bare URLs.
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<\u0000]+)/g, (m, pre, url) => {
      let trail = '';
      const t = url.match(/[.,:!?)\]]+$/);
      if (t) { trail = t[0]; url = url.slice(0, -trail.length); }
      return pre + put(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`) + trail;
    });

    s = emphasis(s);
    while (/\u0000\d+\u0000/.test(s)) s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[+i]);
    return s;
  }

  /* ---- Block parsing ---- */
  const RE_FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)/;
  const RE_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RE_HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const RE_QUOTE = /^\s{0,3}>/;
  const RE_LI = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const RE_TSEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$|^\s*\|\s*:?-+:?\s*\|\s*$/;
  const RE_MATH_OPEN = /^\s*(\$\$|\\\[)/;

  const isTableStart = (lines, i) =>
    i + 1 < lines.length && lines[i].includes('|') && lines[i + 1].includes('|') && RE_TSEP.test(lines[i + 1]);

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells = [];
    let cur = '', tick = false;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (c === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
      if (c === '`') tick = !tick;
      if (c === '|' && !tick) { cells.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }

  function tableHtml(head, aligns, rows) {
    const cls = (a) => (a ? ` class="align-${a}"` : '');
    let out = '<div class="table-wrap" role="region" aria-label="Table" tabindex="0"><table><thead><tr>';
    head.forEach((c, k) => { out += `<th scope="col"${cls(aligns[k])}>${inline(c)}</th>`; });
    out += '</tr></thead><tbody>';
    rows.forEach((r) => {
      out += '<tr>';
      for (let k = 0; k < head.length; k++) out += `<td${cls(aligns[k])}>${inline(r[k] || '')}</td>`;
      out += '</tr>';
    });
    return out + '</tbody></table></div>';
  }

  function collectList(lines, start) {
    const items = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      const m = line.match(RE_LI);
      if (m && !RE_HR.test(line)) {
        items.push({
          indent: m[1].replace(/\t/g, '    ').length,
          ordered: /\d/.test(m[2]),
          num: parseInt(m[2], 10),
          text: m[3],
        });
        i++;
        continue;
      }
      if (!line.trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && j - i <= 2 && RE_LI.test(lines[j]) && !RE_HR.test(lines[j])) { i = j; continue; }
        break;
      }
      if (items.length && /^\s+\S/.test(line) && !RE_FENCE.test(line) && !RE_QUOTE.test(line)) {
        items[items.length - 1].text += ' ' + line.trim();
        i++;
        continue;
      }
      break;
    }
    return [items, i];
  }

  function listHtml(items, i, indent) {
    const ordered = items[i].ordered;
    const startAttr = ordered && items[i].num > 1 ? ` start="${items[i].num}"` : '';
    let out = '';
    while (i < items.length) {
      const it = items[i];
      if (it.indent < indent) break;
      if (it.indent === indent && it.ordered !== ordered) break;
      let li = inline(it.text);
      i++;
      while (i < items.length && items[i].indent > indent) {
        const [child, next] = listHtml(items, i, items[i].indent);
        li += child;
        i = next;
      }
      out += `<li>${li}</li>`;
    }
    const tag = ordered ? 'ol' : 'ul';
    return [`<${tag}${startAttr}>${out}</${tag}>`, i];
  }

  function startsBlock(lines, i) {
    const l = lines[i];
    return RE_FENCE.test(l) || RE_HEADING.test(l) || RE_HR.test(l) || RE_QUOTE.test(l) ||
      RE_LI.test(l) || RE_MATH_OPEN.test(l) || isTableStart(lines, i);
  }

  function renderMarkdown(md) {
    const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      // Fenced code
      let m = line.match(RE_FENCE);
      if (m) {
        const pad = m[1].length, marker = m[2][0], size = m[2].length, lang = m[3];
        const close = new RegExp('^\\s*' + (marker === '`' ? '`' : '~') + '{' + size + ',}\\s*$');
        const buf = [];
        i++;
        while (i < lines.length && !close.test(lines[i])) {
          buf.push(lines[i].replace(new RegExp('^ {0,' + pad + '}'), ''));
          i++;
        }
        i++;
        out.push(codeBlock(buf.join('\n'), lang));
        continue;
      }

      // Display formulas: $$ … $$ or \[ … \]
      m = line.match(RE_MATH_OPEN);
      if (m) {
        const open = m[1], close = open === '$$' ? '$$' : '\\]';
        const first = line.slice(line.indexOf(open) + open.length);
        const buf = [];
        if (first.includes(close)) {
          buf.push(first.slice(0, first.indexOf(close)));
          i++;
        } else {
          buf.push(first);
          i++;
          while (i < lines.length && !lines[i].includes(close)) { buf.push(lines[i]); i++; }
          if (i < lines.length) { buf.push(lines[i].slice(0, lines[i].indexOf(close))); i++; }
        }
        out.push(`<div class="math-block">${mathHtml(buf.join(' '))}</div>`);
        continue;
      }

      // Heading
      m = line.match(RE_HEADING);
      if (m) {
        // The page already has an h1; "#" and "##" both become section headings (h2).
        const level = Math.min(Math.max(m[1].length, 2), 6);
        out.push(`<h${level}>${inline(m[2])}</h${level}>`);
        i++;
        continue;
      }

      // Horizontal rule
      if (RE_HR.test(line)) { out.push('<hr>'); i++; continue; }

      // Blockquote
      if (RE_QUOTE.test(line)) {
        const buf = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) {
          buf.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
          i++;
        }
        out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
        continue;
      }

      // Table
      if (isTableStart(lines, i)) {
        const head = splitRow(line);
        const aligns = splitRow(lines[i + 1]).map((c) =>
          /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : '');
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        out.push(tableHtml(head, aligns, rows));
        continue;
      }

      // List
      if (RE_LI.test(line)) {
        const [items, next] = collectList(lines, i);
        let k = 0;
        while (k < items.length) {
          const [html, after] = listHtml(items, k, items[k].indent);
          out.push(html);
          k = after > k ? after : k + 1;
        }
        i = next;
        continue;
      }

      // Paragraph
      const buf = [];
      while (i < lines.length && lines[i].trim() && (buf.length === 0 || !startsBlock(lines, i))) {
        buf.push(lines[i]);
        i++;
      }
      let html = '';
      buf.forEach((raw, k) => {
        const hard = /( {2,}|\\)$/.test(raw);
        html += inline(raw.trim().replace(/\\$/, ''));
        if (k < buf.length - 1) html += hard ? '<br>' : ' ';
      });
      out.push(`<p>${html}</p>`);
    }
    return out.join('\n');
  }

  /* ---- Allow-list sanitiser (second line of defence) ---- */
  const ALLOWED = {
    p: [], br: [], strong: [], em: [], del: [], code: [], pre: ['tabindex'],
    h2: [], h3: [], h4: [], h5: [], h6: [], ul: [], ol: ['start'], li: [], blockquote: [], hr: [],
    a: ['href', 'target', 'rel'], table: [], thead: [], tbody: [], tr: [], th: ['scope'], td: [],
    div: ['role', 'aria-label', 'tabindex'], span: [], sup: [], sub: [],
    button: ['type', 'aria-label', 'data-copy-code'],
  };

  function sanitizeInto(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html; // inert: scripts do not run and resources do not load
    const walk = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) continue;
        if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue; }
        const tag = child.tagName.toLowerCase();
        const allowed = ALLOWED[tag];
        if (!allowed) { child.replaceWith(document.createTextNode(child.textContent)); continue; }
        for (const attr of Array.from(child.attributes)) {
          const name = attr.name.toLowerCase();
          if (name !== 'class' && !allowed.includes(name)) child.removeAttribute(attr.name);
        }
        if (tag === 'a') {
          if (SAFE_URL.test(child.getAttribute('href') || '')) {
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener noreferrer');
          } else {
            child.removeAttribute('href');
          }
        }
        walk(child);
      }
    };
    walk(tpl.content);
    return tpl.content;
  }

  const renderFragment = (md) => sanitizeInto(renderMarkdown(md));

  function plainText(md) {
    const frag = renderFragment(md);
    $$('.code-block', frag).forEach((n) => n.replaceWith(document.createTextNode(' Code example omitted. ')));
    return (frag.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /* ------------------------------------------------------------------------
     State
     ------------------------------------------------------------------------ */
  const state = {
    convs: [],
    saved: [],
    activeId: null,
    view: 'chat',
    query: '',
    busy: false,
    busyConvId: null,
    stopRequested: false,
  };

  const ui = { drawer: false, collapsed: storage.getRaw(KEY.sidebar) === 'collapsed' };

  function loadConversations() {
    const data = storage.read(KEY.convs, []);
    if (!Array.isArray(data)) return [];
    return data
      .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages))
      .map((c) => ({
        id: c.id,
        title: String(c.title || 'New conversation'),
        createdAt: Number(c.createdAt) || Date.now(),
        updatedAt: Number(c.updatedAt) || Date.now(),
        messages: c.messages
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .map((m) => ({ id: m.id || uid(), role: m.role, content: m.content, ts: Number(m.ts) || Date.now(), error: !!m.error })),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function loadSaved() {
    const data = storage.read(KEY.saved, []);
    if (!Array.isArray(data)) return [];
    return data.filter((s) => s && typeof s.id === 'string' && typeof s.content === 'string');
  }

  function persistConversations() {
    state.convs.sort((a, b) => b.updatedAt - a.updatedAt);
    if (state.convs.length > MAX_CONVERSATIONS) state.convs.length = MAX_CONVERSATIONS;
    while (!storage.write(KEY.convs, state.convs) && state.convs.length > 1) {
      state.convs.pop(); // storage is full: drop the oldest conversation and retry
    }
    storage.setRaw(KEY.active, state.activeId || '');
  }
  const persistSaved = () => storage.write(KEY.saved, state.saved);

  const getConv = (id) => state.convs.find((c) => c.id === id) || null;
  const activeConv = () => getConv(state.activeId);

  /* ------------------------------------------------------------------------
     Elements
     ------------------------------------------------------------------------ */
  const el = {
    app: $('#app'), sidebar: $('#sidebar'), scrim: $('#scrim'),
    sidebarToggle: $('#sidebar-toggle'), sidebarClose: $('#sidebar-close'),
    newChat: $('#new-chat-btn'),
    navChat: $('#nav-chat'), navSearch: $('#nav-search'), navSaved: $('#nav-saved'), savedCount: $('#saved-count'),
    searchWrap: $('#search-wrap'), searchInput: $('#search-input'),
    history: $('#history'),
    profileBtn: $('#profile-btn'), profileAvatar: $('#profile-avatar'), profileName: $('#profile-name'),
    themeToggle: $('#theme-toggle'),
    title: $('#topbar-title'), exportBtn: $('#export-btn'), deleteBtn: $('#delete-btn'),
    viewChat: $('#view-chat'), viewSaved: $('#view-saved'),
    scroll: $('#scroll'), welcome: $('#welcome'), greeting: $('#greeting'), prompts: $('#prompts'), thread: $('#thread'),
    composer: $('#composer'), input: $('#message-input'), mic: $('#mic-btn'), send: $('#send-btn'), hint: $('#composer-hint'),
    savedList: $('#saved-list'),
    dlg: $('#dialog'), dlgForm: $('#dialog-form'), dlgTitle: $('#dialog-title'), dlgText: $('#dialog-text'),
    dlgField: $('#dialog-field'), dlgLabel: $('#dialog-label'), dlgInput: $('#dialog-input'),
    dlgCancel: $('#dialog-cancel'), dlgOk: $('#dialog-ok'),
    status: $('#sr-status'),
  };

  const DEFAULT_HINT = el.hint.textContent;

  function announce(message) {
    el.status.textContent = '';
    window.setTimeout(() => { el.status.textContent = message; }, 30);
  }

  function scrollBehavior() { return mqReduce.matches ? 'auto' : 'smooth'; }
  function scrollToBottom(smooth) {
    el.scroll.scrollTo({ top: el.scroll.scrollHeight, behavior: smooth ? scrollBehavior() : 'auto' });
  }

  /* ------------------------------------------------------------------------
     Theme
     ------------------------------------------------------------------------ */
  function applyTheme(theme, persist = true) {
    root.setAttribute('data-theme', theme);
    if (persist) storage.setRaw(KEY.theme, theme); // only remember an explicit choice
    const next = theme === 'dark' ? 'light' : 'dark';
    el.themeToggle.setAttribute('aria-label', `Switch to ${next} theme`);
    el.themeToggle.title = `Switch to ${next} theme`;
    setIcon(el.themeToggle, theme === 'dark' ? 'sun' : 'moon');
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#202124' : '#F8F8F6');
  }

  /* ------------------------------------------------------------------------
     Sidebar behaviour (desktop collapse, mobile drawer)
     ------------------------------------------------------------------------ */
  function syncSidebar() {
    const mobile = mqMobile.matches;
    root.classList.toggle('sidebar-collapsed', !mobile && ui.collapsed);
    root.classList.toggle('drawer-open', mobile && ui.drawer);
    const open = mobile ? ui.drawer : !ui.collapsed;
    el.sidebar.inert = !open;
    el.sidebarToggle.setAttribute('aria-expanded', String(open));
    el.scrim.hidden = !(mobile && ui.drawer);
    document.body.classList.toggle('no-scroll', mobile && ui.drawer);
  }

  function toggleSidebar() {
    if (mqMobile.matches) {
      ui.drawer = !ui.drawer;
      syncSidebar();
      if (ui.drawer) el.newChat.focus(); else el.sidebarToggle.focus();
    } else {
      ui.collapsed = !ui.collapsed;
      storage.setRaw(KEY.sidebar, ui.collapsed ? 'collapsed' : 'open');
      syncSidebar();
    }
  }

  function closeDrawer(returnFocus) {
    if (!ui.drawer) return;
    ui.drawer = false;
    syncSidebar();
    if (returnFocus) el.sidebarToggle.focus();
  }

  /* ------------------------------------------------------------------------
     Dialog
     ------------------------------------------------------------------------ */
  function openDialog({ title, text = '', confirm = 'Confirm', input = null, solid = false }) {
    return new Promise((resolve) => {
      el.dlgTitle.textContent = title;
      el.dlgText.textContent = text;
      el.dlgText.hidden = !text;
      el.dlgField.hidden = !input;
      el.dlgInput.required = false; // a hidden required field would block the form from submitting
      if (input) {
        el.dlgLabel.textContent = input.label;
        el.dlgInput.value = input.value || '';
        el.dlgInput.placeholder = input.placeholder || '';
        el.dlgInput.required = !!input.required;
      }
      el.dlgOk.textContent = confirm;
      el.dlgOk.className = 'btn ' + (solid ? 'btn-solid' : 'btn-primary');

      const finish = (result) => {
        el.dlgCancel.removeEventListener('click', onCancel);
        el.dlgForm.removeEventListener('submit', onSubmit);
        el.dlg.removeEventListener('click', onBackdrop);
        el.dlg.removeEventListener('close', onClose);
        resolve(result);
      };
      const onCancel = () => el.dlg.close('cancel');
      const onSubmit = (e) => {
        if (input && input.required && !el.dlgInput.value.trim()) { e.preventDefault(); el.dlgInput.focus(); return; }
        el.dlg.dataset.result = input ? el.dlgInput.value.trim() : 'ok';
      };
      const onBackdrop = (e) => { if (e.target === el.dlg) el.dlg.close('cancel'); };
      const onClose = () => {
        const ok = el.dlg.returnValue === 'ok';
        const value = el.dlg.dataset.result;
        delete el.dlg.dataset.result;
        finish(ok ? (input ? value : true) : null);
      };

      el.dlgCancel.addEventListener('click', onCancel);
      el.dlgForm.addEventListener('submit', onSubmit);
      el.dlg.addEventListener('click', onBackdrop);
      el.dlg.addEventListener('close', onClose);
      el.dlg.returnValue = '';
      el.dlg.showModal();
      if (input) { el.dlgInput.focus(); el.dlgInput.select(); } else { el.dlgOk.focus(); }
    });
  }

  /* ------------------------------------------------------------------------
     Clipboard & download
     ------------------------------------------------------------------------ */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;opacity:0;left:-9999px' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function flashCopied(button, label) {
    const original = button.dataset.originalLabel || button.getAttribute('aria-label');
    button.dataset.originalLabel = original;
    if ($('use', button)) setIcon(button, 'check');
    if (button.classList.contains('code-copy')) button.textContent = label;
    button.setAttribute('aria-label', label);
    announce(label);
    window.clearTimeout(button._flash);
    button._flash = window.setTimeout(() => {
      if ($('use', button)) setIcon(button, button.dataset.icon || 'copy');
      if (button.classList.contains('code-copy')) button.textContent = 'Copy';
      button.setAttribute('aria-label', original);
    }, 1600);
  }

  function conversationToMarkdown(conv) {
    const parts = [`# ${conv.title}`, ''];
    for (const m of conv.messages) {
      if (m.error) continue;
      parts.push(m.role === 'user' ? '## You' : '## StudyFlow AI', '', m.content.trim(), '');
    }
    return parts.join('\n');
  }

  function exportConversation() {
    const conv = activeConv();
    if (!conv || !conv.messages.length) return;
    const blob = new Blob([conversationToMarkdown(conv)], { type: 'text/markdown;charset=utf-8' });
    const slug = conv.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'conversation';
    const a = h('a', { href: URL.createObjectURL(blob), download: `studyflow-${slug}.md` });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    announce('Conversation exported');
  }

  /* ------------------------------------------------------------------------
     Speech playback
     ------------------------------------------------------------------------ */
  const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  let speakingId = null;
  let speakToken = 0;

  function chunkText(text, max = 220) {
    const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) || [text];
    const chunks = [];
    let cur = '';
    for (const s of sentences) {
      if ((cur + s).length > max && cur) { chunks.push(cur.trim()); cur = ''; }
      cur += s;
      while (cur.length > max) { chunks.push(cur.slice(0, max)); cur = cur.slice(max); }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks;
  }

  function refreshListenButtons() {
    $$('[data-action="listen"]').forEach((btn) => {
      const holder = btn.closest('[data-id]');
      const active = !!holder && holder.dataset.id === speakingId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
      const label = active ? 'Stop listening' : 'Listen to response';
      btn.setAttribute('aria-label', label);
      btn.title = label;
      setIcon(btn, active ? 'stop' : 'speaker');
    });
  }

  function stopSpeaking() {
    if (!canSpeak) return;
    speakToken++;
    window.speechSynthesis.cancel();
    speakingId = null;
    refreshListenButtons();
  }

  function speak(id, text) {
    if (!canSpeak || !text) return;
    if (speakingId === id) { stopSpeaking(); return; }
    stopSpeaking();
    const token = speakToken;
    speakingId = id;
    const chunks = chunkText(text);
    chunks.forEach((chunk, idx) => {
      const u = new SpeechSynthesisUtterance(chunk);
      const finish = () => { if (token === speakToken && speakingId === id) { speakingId = null; refreshListenButtons(); } };
      if (idx === chunks.length - 1) u.onend = finish;
      u.onerror = finish;
      window.speechSynthesis.speak(u);
    });
    refreshListenButtons();
  }

  /* ------------------------------------------------------------------------
     Voice input
     ------------------------------------------------------------------------ */
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  // Fallback for browsers without built-in speech recognition (for example Firefox):
  // record audio here and let the server transcribe it.
  const TRANSCRIBE_URL = '/api/transcribe';
  const MAX_RECORD_MS = 120000;
  const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  let useRecorder = !SpeechRecognitionCtor && canRecord;
  let recognition = null;
  let recorder = null;
  let recStream = null;
  let recChunks = [];
  let recTimer = null;
  let discardRecording = false;
  let transcribing = false;
  let listening = false;
  let hintTimer = null;

  function setHint(text, isStatus, sticky) {
    window.clearTimeout(hintTimer);
    el.hint.textContent = text || DEFAULT_HINT;
    el.hint.classList.toggle('is-status', !!isStatus);
    if (isStatus && text && !listening && !sticky) {
      hintTimer = window.setTimeout(() => updateComposer(), 4500);
    }
  }

  function setListening(on) {
    listening = on;
    el.mic.classList.toggle('is-listening', on);
    el.mic.setAttribute('aria-pressed', String(on));
    const label = on ? 'Stop voice input' : 'Start voice input';
    el.mic.setAttribute('aria-label', label);
    el.mic.title = label;
    if (on) setHint('Listening… speak your question', true);
    else updateComposer();
  }

  function releaseStream() {
    if (recStream) { recStream.getTracks().forEach((t) => t.stop()); recStream = null; }
  }

  /** Stop the recorder. With discard=true the audio is thrown away instead of transcribed. */
  function stopRecording(discard) {
    window.clearTimeout(recTimer);
    if (recorder && recorder.state !== 'inactive') {
      discardRecording = !!discard;
      try { recorder.stop(); } catch { releaseStream(); recorder = null; setListening(false); }
      return true;
    }
    return false;
  }

  /** Called when other actions (sending, switching chats) need the mic off; nothing is transcribed. */
  function stopVoice() {
    if (stopRecording(true)) return;
    if (recognition) { try { recognition.stop(); } catch { /* already stopped */ } }
  }

  /** Called from the mic button: finish speaking and keep what was said. */
  function finishVoice() {
    if (stopRecording(false)) return;
    stopVoice();
  }

  function pickMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  }

  async function startRecording() {
    if (listening || transcribing || !canRecord) return;
    stopSpeaking();
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const missing = err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError');
      setHint(missing ? 'No microphone was found.' : 'Microphone access is blocked. Allow it in your browser settings to use voice input.', true);
      return;
    }
    const mime = pickMimeType();
    recChunks = [];
    try {
      recorder = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
    } catch {
      releaseStream();
      setHint('Voice recording is not supported in this browser.', true);
      return;
    }
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    recorder.onstop = onRecordingStop;
    discardRecording = false;
    recorder.start();
    setListening(true);
    setHint('Recording… tap the microphone when you are done', true, true);
    recTimer = window.setTimeout(() => stopRecording(false), MAX_RECORD_MS);
  }

  async function onRecordingStop() {
    const type = (recorder && recorder.mimeType) || 'audio/webm';
    const blob = new Blob(recChunks, { type });
    const discard = discardRecording;
    recChunks = [];
    recorder = null;
    releaseStream();
    setListening(false);
    if (discard) return;
    if (blob.size < 1500) { setHint('No speech detected. Try again.', true); return; }

    transcribing = true;
    el.mic.disabled = true;
    setHint('Transcribing…', true, true);
    try {
      const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('audio', blob, 'speech.' + ext);
      const res = await fetch(TRANSCRIBE_URL, { method: 'POST', body: form });
      let data = null;
      try { data = await res.json(); } catch { /* non-JSON body */ }
      if (!res.ok) throw new Error((data && data.error) || 'Could not transcribe the recording.');
      const text = ((data && data.text) || '').trim();
      if (!text) {
        setHint('No speech detected. Try again.', true);
      } else {
        const base = el.input.value;
        el.input.value = base + (base && !/\s$/.test(base) ? ' ' : '') + text;
        autosize();
        updateComposer();
        el.input.focus({ preventScroll: true });
      }
    } catch (err) {
      setHint(err instanceof TypeError ? 'Could not reach the server. Check your connection and try again.' : err.message, true);
    } finally {
      transcribing = false;
      el.mic.disabled = false;
    }
  }

  function startVoice() {
    if (useRecorder) { startRecording(); return; }
    if (!SpeechRecognitionCtor || listening) return;
    stopSpeaking();
    const base = el.input.value;
    let finalText = '';
    recognition = new SpeechRecognitionCtor();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      let interim = '';
      finalText = '';
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      const spoken = (finalText + interim).trim();
      const sep = base && !/\s$/.test(base) ? ' ' : '';
      el.input.value = base + sep + spoken;
      autosize();
      updateComposer();
    };
    recognition.onerror = (event) => {
      const messages = {
        'not-allowed': 'Microphone access is blocked. Allow it in your browser settings to use voice input.',
        'service-not-allowed': 'Microphone access is blocked. Allow it in your browser settings to use voice input.',
        'no-speech': 'No speech detected. Try again.',
        'audio-capture': 'No microphone was found.',
        'network': 'Voice input needs an internet connection.',
      };
      if (event.error !== 'aborted') {
        listening = false;
        if (event.error === 'network' && canRecord) {
          // The browser's own speech service is unreachable (some browsers ship it without a backend).
          useRecorder = true;
          setHint('Live speech recognition is unavailable here. Tap the microphone again to record your question instead.', true);
        } else {
          setHint(messages[event.error] || 'Voice input stopped unexpectedly.', true);
        }
      }
    };
    recognition.onend = () => {
      const wasListening = listening;
      listening = false;
      el.mic.classList.remove('is-listening');
      el.mic.setAttribute('aria-pressed', 'false');
      el.mic.setAttribute('aria-label', 'Start voice input');
      el.mic.title = 'Start voice input';
      if (wasListening) updateComposer();
      el.input.focus({ preventScroll: true });
    };

    try { recognition.start(); setListening(true); } catch { setListening(false); }
  }

  /* ------------------------------------------------------------------------
     Rendering: sidebar
     ------------------------------------------------------------------------ */
  function groupByDate(list) {
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const today = startOfDay(new Date());
    const buckets = [['Today', []], ['Yesterday', []], ['Previous 7 days', []], ['Older', []]];
    for (const c of list) {
      const diff = Math.round((today - startOfDay(new Date(c.updatedAt))) / 864e5);
      buckets[diff <= 0 ? 0 : diff === 1 ? 1 : diff <= 7 ? 2 : 3][1].push(c);
    }
    return buckets.filter((b) => b[1].length);
  }

  function historyItem(c) {
    const isActive = c.id === state.activeId && state.view === 'chat';
    return h('li', { class: 'hist-item' + (isActive ? ' is-active' : '') },
      h('button', {
        type: 'button', class: 'hist-link', dataset: { open: c.id },
        'aria-current': isActive ? 'true' : null, title: c.title, text: c.title,
      }),
      h('div', { class: 'hist-actions' },
        h('button', { type: 'button', class: 'icon-btn xs', dataset: { rename: c.id }, 'aria-label': `Rename conversation: ${c.title}`, title: 'Rename' }, icon('pencil')),
        h('button', { type: 'button', class: 'icon-btn xs', dataset: { remove: c.id }, 'aria-label': `Delete conversation: ${c.title}`, title: 'Delete' }, icon('trash'))));
  }

  function renderSidebar() {
    const q = state.query.trim().toLowerCase();
    const list = q
      ? state.convs.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)))
      : state.convs;

    el.history.replaceChildren();
    if (!state.convs.length) {
      el.history.append(h('p', { class: 'hist-empty', text: 'Your conversations will appear here.' }));
    } else if (!list.length) {
      el.history.append(h('p', { class: 'hist-empty', text: 'No conversations match your search.' }));
    } else {
      const groups = q ? [['Results', list]] : groupByDate(list);
      for (const [label, items] of groups) {
        el.history.append(h('section', { class: 'hist-group' },
          h('h2', { class: 'hist-label', text: label }),
          h('ul', { class: 'hist-list' }, items.map(historyItem))));
      }
    }

    const count = state.saved.length;
    el.savedCount.hidden = count === 0;
    el.savedCount.textContent = String(count);
  }

  /* ------------------------------------------------------------------------
     Rendering: messages
     ------------------------------------------------------------------------ */
  function actionButton(action, label, iconName, extra) {
    const btn = h('button', {
      type: 'button', class: 'icon-btn sm', 'aria-label': label, title: label,
      dataset: Object.assign({ action, icon: iconName }, extra || {}),
    }, icon(iconName));
    return btn;
  }

  function assistantHead() {
    return h('div', { class: 'msg-head' },
      h('span', { class: 'msg-mark', 'aria-hidden': 'true' }, icon('logo')),
      h('span', { class: 'msg-who', text: 'StudyFlow AI' }));
  }

  function isSaved(id) { return state.saved.some((s) => s.id === id); }

  function messageEl(msg, opts = {}) {
    if (msg.role === 'user') {
      return h('article', { class: 'msg msg-user', dataset: { id: msg.id } },
        h('div', { class: 'bubble', text: msg.content }));
    }
    if (msg.error) {
      return h('article', { class: 'msg msg-ai', dataset: { id: msg.id } },
        assistantHead(),
        h('div', { class: 'msg-error', role: 'alert' },
          h('p', { text: msg.content }),
          h('button', { type: 'button', class: 'btn btn-sm', dataset: { action: 'retry' } }, icon('refresh'), 'Try again')));
    }
    const prose = h('div', { class: 'prose' });
    prose.append(renderFragment(msg.content));
    const saved = isSaved(msg.id);
    const saveBtn = actionButton('save', saved ? 'Remove from saved' : 'Save response', 'bookmark');
    saveBtn.classList.toggle('is-saved', saved);
    saveBtn.setAttribute('aria-pressed', String(saved));
    const actions = h('div', { class: 'msg-actions', role: 'group', 'aria-label': 'Response actions' },
      actionButton('copy', 'Copy response', 'copy'),
      canSpeak ? actionButton('listen', 'Listen to response', 'speaker') : null,
      saveBtn,
      opts.last ? actionButton('regen', 'Regenerate response', 'refresh') : null);
    return h('article', { class: 'msg msg-ai', dataset: { id: msg.id } }, assistantHead(), prose, actions);
  }

  let pendingEl = null;
  let pendingTimer = null;

  function showPending() {
    hidePending();
    const label = h('span', { text: 'Thinking…' });
    pendingEl = h('article', { class: 'msg msg-ai', 'aria-busy': 'true' },
      assistantHead(),
      h('div', { class: 'typing', role: 'status' },
        h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
        label));
    el.thread.append(pendingEl);
    scrollToBottom(true);
    const started = Date.now();
    pendingTimer = window.setInterval(() => {
      const s = (Date.now() - started) / 1000;
      label.textContent = s > 25 ? 'This is taking longer than usual…' : s > 8 ? 'Still working on it…' : 'Thinking…';
    }, 1000);
  }

  function hidePending() {
    window.clearInterval(pendingTimer);
    if (pendingEl) { pendingEl.remove(); pendingEl = null; }
  }

  function renderThread() {
    hidePending();
    el.thread.replaceChildren();
    const conv = activeConv();
    const messages = conv ? conv.messages : [];
    const lastAi = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return messages[i]; return null; })();
    for (const m of messages) el.thread.append(messageEl(m, { last: m === lastAi && m === messages[messages.length - 1] }));
    el.welcome.hidden = messages.length > 0;
    if (state.busy && conv && conv.id === state.busyConvId) showPending();
    refreshListenButtons();
    scrollToBottom(false);
  }

  function renderGreeting() {
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const name = storage.getRaw(KEY.name);
    el.greeting.textContent = name ? `${part}, ${name}` : part;
  }

  function renderProfile() {
    const name = (storage.getRaw(KEY.name) || '').trim();
    el.profileName.textContent = name || 'Guest';
    el.profileAvatar.textContent = (name || 'G').charAt(0).toUpperCase();
    el.profileBtn.setAttribute('aria-label', name ? `Edit your name (${name})` : 'Set your name');
    renderGreeting();
  }

  function renderSaved() {
    el.savedList.replaceChildren();
    if (!state.saved.length) {
      el.savedList.append(h('p', { class: 'saved-empty', text: 'Nothing saved yet. Use the bookmark button under any response to keep it here.' }));
      return;
    }
    for (const s of state.saved.slice().sort((a, b) => b.ts - a.ts)) {
      const prose = h('div', { class: 'prose' });
      prose.append(renderFragment(s.content));
      const exists = !!getConv(s.convId);
      el.savedList.append(h('article', { class: 'saved-item', dataset: { id: s.id } },
        h('p', { class: 'saved-q', text: s.question || 'Saved response' }),
        prose,
        h('div', { class: 'msg-actions', role: 'group', 'aria-label': 'Saved response actions' },
          actionButton('copy', 'Copy response', 'copy'),
          canSpeak ? actionButton('listen', 'Listen to response', 'speaker') : null,
          actionButton('unsave', 'Remove from saved', 'trash'),
          exists ? actionButton('open-conv', 'Open conversation', 'chat', { conv: s.convId }) : null)));
    }
    refreshListenButtons();
  }

  function updateTopbar() {
    if (state.view === 'saved') {
      el.title.textContent = 'Saved responses';
      el.exportBtn.hidden = true;
      el.deleteBtn.hidden = true;
      return;
    }
    const conv = activeConv();
    el.title.textContent = conv ? conv.title : 'New conversation';
    const has = !!conv && conv.messages.length > 0;
    el.exportBtn.hidden = false;
    el.deleteBtn.hidden = false;
    el.exportBtn.disabled = !has;
    el.deleteBtn.disabled = !conv;
    document.title = conv ? `${conv.title} · StudyFlow AI` : 'StudyFlow AI';
  }

  function setView(view) {
    state.view = view;
    const chat = view === 'chat';
    el.viewChat.hidden = !chat;
    el.viewSaved.hidden = chat;
    el.navChat.classList.toggle('is-active', chat);
    el.navSaved.classList.toggle('is-active', !chat);
    if (chat) el.navChat.setAttribute('aria-current', 'page'); else el.navChat.removeAttribute('aria-current');
    if (!chat) el.navSaved.setAttribute('aria-current', 'page'); else el.navSaved.removeAttribute('aria-current');
    if (!chat) { stopVoice(); renderSaved(); }
    updateTopbar();
    renderSidebar();
  }

  /* ------------------------------------------------------------------------
     Composer
     ------------------------------------------------------------------------ */
  function autosize() {
    const ta = el.input;
    ta.style.height = 'auto';
    const max = parseFloat(getComputedStyle(ta).maxHeight) || 200;
    ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
  }

  function updateComposer() {
    const hasText = el.input.value.trim().length > 0;
    const busyHere = state.busy && state.busyConvId === state.activeId;
    const busyElsewhere = state.busy && !busyHere;
    el.send.classList.toggle('is-stop', busyHere);
    setIcon(el.send, busyHere ? 'stop' : 'send');
    el.send.setAttribute('aria-label', busyHere ? 'Stop generating' : 'Send message');
    el.send.title = busyHere ? 'Stop generating' : 'Send message';
    el.send.disabled = busyHere ? false : (busyElsewhere || !hasText);
    if (!listening) {
      if (busyElsewhere) setHint('Finishing a response in another conversation…', true);
      else setHint(DEFAULT_HINT, false);
    }
  }

  /* ------------------------------------------------------------------------
     Conversations
     ------------------------------------------------------------------------ */
  function titleFrom(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > 60 ? t.slice(0, 57).trimEnd() + '…' : t;
  }

  function newConversation() {
    const now = Date.now();
    const conv = { id: uid(), title: 'New conversation', createdAt: now, updatedAt: now, messages: [] };
    state.convs.unshift(conv);
    state.activeId = conv.id;
    return conv;
  }

  function openConversation(id) {
    if (!getConv(id)) return;
    stopSpeaking();
    stopVoice();
    state.activeId = id;
    storage.setRaw(KEY.active, id);
    setView('chat');
    renderThread();
    updateTopbar();
    updateComposer();
    closeDrawer(false);
  }

  function startNewChat() {
    stopSpeaking();
    stopVoice();
    state.activeId = null;
    storage.setRaw(KEY.active, '');
    setView('chat');
    renderThread();
    updateTopbar();
    updateComposer();
    closeDrawer(false);
    if (!mqCoarse.matches) el.input.focus();
  }

  async function renameConversation(id) {
    const conv = getConv(id);
    if (!conv) return;
    const value = await openDialog({
      title: 'Rename conversation', confirm: 'Save',
      input: { label: 'Title', value: conv.title, required: true },
    });
    if (!value) return;
    conv.title = value.slice(0, 60);
    persistConversations();
    renderSidebar();
    updateTopbar();
  }

  async function deleteConversation(id) {
    const conv = getConv(id);
    if (!conv) return;
    const ok = await openDialog({
      title: 'Delete this conversation?',
      text: `“${conv.title}” will be removed from this device. Saved responses from it are kept.`,
      confirm: 'Delete', solid: true,
    });
    if (!ok) return;
    if (state.busy && state.busyConvId === id) abortRequest();
    state.convs = state.convs.filter((c) => c.id !== id);
    if (state.activeId === id) {
      stopSpeaking();
      state.activeId = null;
      renderThread();
    }
    persistConversations();
    renderSidebar();
    updateTopbar();
    updateComposer();
    announce('Conversation deleted');
  }

  /* ------------------------------------------------------------------------
     Backend request
     ------------------------------------------------------------------------ */
  let controller = null;
  let timedOut = false;

  function abortRequest() {
    state.stopRequested = true;
    if (controller) controller.abort();
  }

  async function askBackend(message, signal) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ message }),
      signal,
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok) {
      const detail = data && (data.error || data.message || data.answer);
      throw new Error(typeof detail === 'string' && detail ? detail : `The server responded with an error (${res.status}).`);
    }
    if (!data || typeof data.answer !== 'string' || !data.answer.trim()) {
      throw new Error('The server returned an empty or unexpected response.');
    }
    return data.answer;
  }

  function setBusy(on, convId) {
    state.busy = on;
    state.busyConvId = on ? convId : null;
    updateComposer();
  }

  function lastQuestion(conv, beforeIndex) {
    for (let i = beforeIndex - 1; i >= 0; i--) if (conv.messages[i].role === 'user') return conv.messages[i].content;
    return null;
  }

  async function requestAnswer(conv, question) {
    setBusy(true, conv.id);
    state.stopRequested = false;
    timedOut = false;
    if (state.activeId === conv.id && state.view === 'chat') showPending();

    controller = new AbortController();
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    let msg;
    try {
      const answer = await askBackend(question, controller.signal);
      msg = { id: uid(), role: 'assistant', content: answer.trim(), ts: Date.now(), error: false };
    } catch (err) {
      let text;
      if (err && err.name === 'AbortError') {
        text = timedOut ? 'The request took too long and was cancelled.' : 'Response stopped.';
      } else if (err instanceof TypeError) {
        text = 'Could not reach the server. Check your connection and try again.';
      } else {
        text = (err && err.message) || 'Something went wrong. Please try again.';
      }
      msg = { id: uid(), role: 'assistant', content: text, ts: Date.now(), error: true };
    } finally {
      window.clearTimeout(timer);
      controller = null;
    }

    const stillOpen = state.activeId === conv.id && state.view === 'chat';
    hidePending();
    if (getConv(conv.id)) {
      conv.messages.push(msg);
      conv.updatedAt = Date.now();
      persistConversations();
    }
    setBusy(false, null);
    renderSidebar();

    if (stillOpen && getConv(conv.id)) {
      $$('[data-action="regen"]', el.thread).forEach((b) => b.remove());
      const node = messageEl(msg, { last: true });
      el.thread.append(node);
      node.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
      updateTopbar();
    }
    announce(msg.error ? 'The response failed.' : 'Response ready.');
  }

  async function sendMessage(raw) {
    const text = String(raw).trim();
    if (!text || state.busy) return;
    stopVoice();
    stopSpeaking();

    let conv = activeConv();
    if (!conv) conv = newConversation();
    if (state.view !== 'chat') setView('chat');

    const userMsg = { id: uid(), role: 'user', content: text, ts: Date.now(), error: false };
    if (!conv.messages.length) conv.title = titleFrom(text);
    conv.messages.push(userMsg);
    conv.updatedAt = Date.now();
    persistConversations();

    el.welcome.hidden = true;
    $$('[data-action="regen"]', el.thread).forEach((b) => b.remove());
    el.thread.append(messageEl(userMsg));
    el.input.value = '';
    autosize();
    renderSidebar();
    updateTopbar();
    scrollToBottom(true);
    await requestAnswer(conv, text);
  }

  async function regenerate(msgId) {
    const conv = activeConv();
    if (!conv || state.busy) return;
    const idx = conv.messages.findIndex((m) => m.id === msgId);
    if (idx === -1 || idx !== conv.messages.length - 1) return;
    const question = lastQuestion(conv, idx);
    if (!question) return;
    stopSpeaking();
    conv.messages.splice(idx, 1);
    persistConversations();
    const node = $(`.msg[data-id="${CSS.escape(msgId)}"]`, el.thread);
    if (node) node.remove();
    await requestAnswer(conv, question);
  }

  /* ------------------------------------------------------------------------
     Saved responses
     ------------------------------------------------------------------------ */
  function toggleSave(msgId, button) {
    const conv = activeConv();
    const existing = state.saved.findIndex((s) => s.id === msgId);
    if (existing !== -1) {
      state.saved.splice(existing, 1);
      announce('Removed from saved responses');
    } else if (conv) {
      const idx = conv.messages.findIndex((m) => m.id === msgId);
      if (idx === -1) return;
      state.saved.push({
        id: msgId, convId: conv.id, question: lastQuestion(conv, idx) || '',
        content: conv.messages[idx].content, ts: Date.now(),
      });
      announce('Saved response');
    }
    persistSaved();
    if (button) {
      const on = isSaved(msgId);
      button.classList.toggle('is-saved', on);
      button.setAttribute('aria-pressed', String(on));
      const label = on ? 'Remove from saved' : 'Save response';
      button.setAttribute('aria-label', label);
      button.title = label;
    }
    renderSidebar();
  }

  /* ------------------------------------------------------------------------
     Event wiring
     ------------------------------------------------------------------------ */
  function messageText(holder) {
    const id = holder.dataset.id;
    const conv = activeConv();
    const fromConv = conv && conv.messages.find((m) => m.id === id);
    if (fromConv) return fromConv.content;
    const saved = state.saved.find((s) => s.id === id);
    return saved ? saved.content : '';
  }

  async function handleAction(btn) {
    const action = btn.dataset.action;
    const holder = btn.closest('[data-id]');
    if (!holder) return;
    const id = holder.dataset.id;

    if (action === 'copy') {
      const ok = await copyText(messageText(holder));
      if (ok) flashCopied(btn, 'Copied'); else announce('Copy failed');
    } else if (action === 'listen') {
      speak(id, plainText(messageText(holder)));
    } else if (action === 'save') {
      toggleSave(id, btn);
    } else if (action === 'regen' || action === 'retry') {
      regenerate(id);
    } else if (action === 'unsave') {
      state.saved = state.saved.filter((s) => s.id !== id);
      persistSaved();
      renderSaved();
      renderSidebar();
      announce('Removed from saved responses');
    } else if (action === 'open-conv') {
      openConversation(btn.dataset.conv);
    }
  }

  async function handleCodeCopy(btn) {
    const pre = btn.closest('.code-block');
    const code = pre ? $('pre', pre) : null;
    if (!code) return;
    const ok = await copyText(code.textContent || '');
    if (ok) flashCopied(btn, 'Copied');
  }

  function onContentClick(e) {
    const codeBtn = e.target.closest('[data-copy-code]');
    if (codeBtn) { handleCodeCopy(codeBtn); return; }
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) handleAction(actionBtn);
  }

  function openSearch(focus) {
    el.searchWrap.hidden = false;
    el.navSearch.setAttribute('aria-expanded', 'true');
    if (ui.collapsed && !mqMobile.matches) { ui.collapsed = false; storage.setRaw(KEY.sidebar, 'open'); }
    if (mqMobile.matches && !ui.drawer) ui.drawer = true;
    syncSidebar();
    if (focus) el.searchInput.focus();
  }

  function closeSearch() {
    el.searchInput.value = '';
    state.query = '';
    el.searchWrap.hidden = true;
    el.navSearch.setAttribute('aria-expanded', 'false');
    renderSidebar();
  }

  function bindEvents() {
    /* Sidebar */
    el.sidebarToggle.addEventListener('click', toggleSidebar);
    el.sidebarClose.addEventListener('click', () => closeDrawer(true));
    el.scrim.addEventListener('click', () => closeDrawer(true));
    el.newChat.addEventListener('click', startNewChat);

    el.navChat.addEventListener('click', () => { setView('chat'); closeDrawer(false); if (!mqCoarse.matches) el.input.focus(); });
    el.navSaved.addEventListener('click', () => { setView('saved'); closeDrawer(false); });
    el.navSearch.addEventListener('click', () => {
      if (el.searchWrap.hidden) openSearch(true); else closeSearch();
    });
    el.searchInput.addEventListener('input', () => { state.query = el.searchInput.value; renderSidebar(); });
    el.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeSearch(); el.navSearch.focus(); }
    });

    el.history.addEventListener('click', (e) => {
      const open = e.target.closest('[data-open]');
      const rename = e.target.closest('[data-rename]');
      const remove = e.target.closest('[data-remove]');
      if (open) openConversation(open.dataset.open);
      else if (rename) renameConversation(rename.dataset.rename);
      else if (remove) deleteConversation(remove.dataset.remove);
    });

    el.themeToggle.addEventListener('click', () => {
      applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });

    el.profileBtn.addEventListener('click', async () => {
      const value = await openDialog({
        title: 'Your name', confirm: 'Save',
        text: 'Used for the greeting on the home screen. It stays in this browser.',
        input: { label: 'Display name', value: storage.getRaw(KEY.name) || '', placeholder: 'For example, Asha' },
      });
      if (value === null) return;
      storage.setRaw(KEY.name, value.trim());
      renderProfile();
    });

    /* Top bar */
    el.exportBtn.addEventListener('click', exportConversation);
    el.deleteBtn.addEventListener('click', () => { if (state.activeId) deleteConversation(state.activeId); });

    /* Welcome prompts */
    el.prompts.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-prompt]');
      if (btn) sendMessage(btn.dataset.prompt);
    });

    /* Messages & saved list */
    el.thread.addEventListener('click', onContentClick);
    el.savedList.addEventListener('click', onContentClick);

    /* Composer */
    el.input.addEventListener('input', () => { autosize(); updateComposer(); });
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        if (!state.busy && el.input.value.trim()) el.composer.requestSubmit();
      }
    });
    el.send.addEventListener('click', (e) => {
      if (state.busy && state.busyConvId === state.activeId) { e.preventDefault(); abortRequest(); }
    });
    el.composer.addEventListener('submit', (e) => {
      e.preventDefault();
      if (state.busy) return;
      sendMessage(el.input.value);
    });

    if (SpeechRecognitionCtor || canRecord) {
      el.mic.addEventListener('click', () => { if (listening) finishVoice(); else startVoice(); });
    } else {
      el.mic.disabled = true;
      el.mic.title = 'Voice input is not supported in this browser';
      el.mic.setAttribute('aria-label', 'Voice input is not supported in this browser');
    }

    /* Global */
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearch(true);
      } else if (e.key === 'Escape' && ui.drawer && !el.dlg.open) {
        closeDrawer(true);
      }
    });
    mqMobile.addEventListener('change', () => { ui.drawer = false; syncSidebar(); });
    window.addEventListener('beforeunload', () => { if (canSpeak) window.speechSynthesis.cancel(); });
  }

  /* ------------------------------------------------------------------------
     Init
     ------------------------------------------------------------------------ */
  function init() {
    state.convs = loadConversations();
    state.saved = loadSaved();
    const remembered = storage.getRaw(KEY.active);
    state.activeId = remembered && getConv(remembered) ? remembered : null;

    applyTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light', false);
    renderProfile();
    syncSidebar();
    bindEvents();
    setView('chat');
    renderThread();
    updateTopbar();
    updateComposer();
    autosize();
    if (!mqCoarse.matches) el.input.focus({ preventScroll: true });
  }

  init();
})();
