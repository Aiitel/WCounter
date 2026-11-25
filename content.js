(() => {
  const api = globalThis.browser || globalThis.chrome;
  const KEY = 'wcounter:days';
  const SETTINGS = 'wcounter:selectedChat';
  let timer;
  let running = false;
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const sameName = (a, b) => clean(a).normalize('NFKC').toLocaleLowerCase() === clean(b).normalize('NFKC').toLocaleLowerCase();
  const localDay = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const messageDay = raw => {
    const m = (raw || '').match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
    if (!m) return localDay();
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    const first = Number(m[1]), second = Number(m[2]);
    const month = first > 12 ? second : second > 12 ? first : second;
    const day = first > 12 ? first : second > 12 ? second : first;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  const withinCountingHours = raw => {
    const match = (raw || '').match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
    if (!match) return false;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (match[3]) {
      const pm = match[3].toUpperCase() === 'PM';
      hour = (hour % 12) + (pm ? 12 : 0);
    }
    const minutes = hour * 60 + minute;
    return minutes >= 8 * 60 && minutes <= 19 * 60;
  };
  const sha256 = async value => {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  };
  const messageTimestamp = (raw, day) => {
    const match = (raw || '').match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
    if (!match) return `${day}T00:00`;
    let hour = Number(match[1]);
    if (match[3]) hour = (hour % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0);
    return `${day}T${String(hour).padStart(2, '0')}:${match[2]}`;
  };

  function activeTitles() {
    const header = document.querySelector('#main header');
    if (!header) return [];
    const values = [];
    const preferred = [
      '[data-testid="conversation-info-header-chat-title"]',
      '[data-testid="conversation-panel-header-chat-title"]',
      '[data-testid="conversation-header-name"]'
    ];
    for (const selector of preferred) {
      for (const el of header.querySelectorAll(selector)) values.push(clean(el.textContent || el.getAttribute('title')));
    }
    for (const el of header.querySelectorAll('[title], [dir="auto"]')) values.push(clean(el.getAttribute('title') || el.textContent));
    return [...new Set(values.filter(s => s && s.length < 120))];
  }

  function listChats() {
    const pane = document.querySelector('#pane-side');
    if (!pane) return [];
    const nodes = pane.querySelectorAll('[data-testid="cell-frame-container"], [role="listitem"], [role="row"]');
    const chats = new Map();
    for (const node of nodes) {
      const name = clean(node.querySelector('[title]')?.getAttribute('title'));
      if (name && name.length <= 120 && !chats.has(name)) chats.set(name, { id: name, name, detail: '' });
    }
    return [...chats.values()];
  }

  function directionOf(el) {
    // WhatsApp pu� mettere i metadati su un figlio e la direzione sul contenitore o su un suo discendente.
    for (let node = el; node && node.id !== 'main'; node = node.parentElement) {
      const classes = typeof node.className === 'string' ? node.className : '';
      const testid = node.getAttribute?.('data-testid') || '';
      const dataId = node.getAttribute?.('data-id') || '';
      if (dataId.startsWith('true_')) return 'sent';
      if (dataId.startsWith('false_')) return 'received';
      if (classes.includes('message-out') || testid.includes('message-out')) return 'sent';
      if (classes.includes('message-in') || testid.includes('message-in')) return 'received';
      if (testid.includes('msg-container')) {
        const child = node.querySelector('.message-out, .message-in, [data-testid*="message-out"], [data-testid*="message-in"]');
        if (child) {
          const childClasses = typeof child.className === 'string' ? child.className : '';
          const childTestid = child.getAttribute('data-testid') || '';
          if (childClasses.includes('message-out') || childTestid.includes('message-out')) return 'sent';
          if (childClasses.includes('message-in') || childTestid.includes('message-in')) return 'received';
        }
        const childWithId = node.querySelector('[data-id^="true_"], [data-id^="false_"]');
        const childDataId = childWithId?.getAttribute('data-id') || '';
        if (childDataId.startsWith('true_')) return 'sent';
        if (childDataId.startsWith('false_')) return 'received';
      }
    }
    return layoutDirection(el);
  }

  function layoutDirection(el) {
    const main = document.querySelector('#main');
    if (!main || typeof el.getBoundingClientRect !== 'function') return '';
    const area = main.getBoundingClientRect();
    if (!area.width) return '';

    let box = el.getBoundingClientRect();
    if (box.width >= area.width * 0.9) {
      let widest = null;
      for (const child of el.querySelectorAll('*')) {
        const candidate = child.getBoundingClientRect();
        if (candidate.width > 0 && candidate.width < area.width * 0.9 &&
            (!widest || candidate.width > widest.width)) {
          widest = candidate;
        }
      }
      if (widest) box = widest;
    }

    const leftGap = box.left - area.left;
    const rightGap = area.right - box.right;
    const threshold = area.width * 0.05;
    if (leftGap > rightGap + threshold) return 'sent';
    if (rightGap > leftGap + threshold) return 'received';
    return '';
  }

  function messageStats() {
    const elements = messageElements();
    let sent = 0;
    let received = 0;
    for (const el of elements) {
      const direction = directionOf(el);
      if (direction === 'sent') sent++;
      if (direction === 'received') received++;
    }
    return { tagged: elements.length, sent, received };
  }

  function messageElements() {
    const selectors = [
      '#main [data-testid="msg-container"], #main [data-testid*="msg-container"]',
      '#main .message-in, #main .message-out',
      '#main [data-id^="true_"], #main [data-id^="false_"]',
      '#main [data-pre-plain-text]'
    ];
    const candidates = new Set();
    for (const selector of selectors) document.querySelectorAll(selector).forEach(el => candidates.add(el));
    return [...candidates].filter(el => ![...candidates].some(other => other !== el && other.contains(el)));
  }

  async function scan() {
    if (running) {
      scanPending = true;
      return;
    }
    running = true;
    try {
      const stored = await api.storage.local.get([KEY, SETTINGS]);
      const selected = stored[SETTINGS];
      if (!selected || !activeTitles().some(name => sameName(name, selected.name))) return;
      const elements = messageElements();
      if (!elements.length) return;
      const days = stored[KEY] || {};
      const today = localDay();
      const existingDayKeys = new Set(Object.keys(days));
      let changed = false;
      for (const row of Object.values(days)) {
        if (row.day !== today) {
          if (row.ids || row.messageHashes || row.lastMessage) {
            delete row.ids;
            delete row.messageHashes;
            delete row.lastMessage;
            changed = true;
          }
          continue;
        }
        if (!Array.isArray(row.ids)) row.ids = [];
        if (Array.isArray(row.messageHashes)) {
          row.ids = [...new Set([...row.ids, ...row.messageHashes])];
          delete row.messageHashes;
          changed = true;
        }
        for (let i = 0; i < row.ids.length; i++) {
          if (!/^[a-f0-9]{64}$/i.test(row.ids[i])) {
            row.ids[i] = await sha256(row.ids[i]);
            changed = true;
          }
        }
      }
      const seenThisScan = new Set();
      for (const el of elements) {
        const direction = directionOf(el);
        if (!direction) continue;
        const metaElement = el.matches('[data-pre-plain-text]') ? el : el.querySelector('[data-pre-plain-text]');
        const meta = metaElement?.getAttribute('data-pre-plain-text') || '';
        if (!withinCountingHours(meta)) continue;
        const container = el.closest('[data-id]') || el.querySelector('[data-id]') || el;
        const dataMessageId = container?.getAttribute('data-id') || '';
        const messageText = clean(el.textContent).normalize('NFKC');
        const previousMessageId = dataMessageId || meta || await sha256(messageText);
        const messageId = dataMessageId || `${meta}|${messageText}`;
        const day = messageDay(meta);
        const key = `${selected.id}|${day}`;
        if (day !== today && existingDayKeys.has(key)) continue;
        const row = days[key] || {
          chatId: selected.id, chatName: selected.name, day, sent: 0, received: 0,
          ...(day === today ? { ids: [] } : {})
        };
        if (day === today && !Array.isArray(row.ids)) row.ids = [];
        const timestamp = messageTimestamp(meta, day);
        const textHash = await sha256(clean(el.textContent).normalize('NFKC'));
        if (day === today) {
          const stableHash = await sha256(`${direction}:${messageId}`);
          const oldIdentityHash = await sha256(`${direction}:${previousMessageId}`);
          const oldFingerprintHash = await sha256(`${direction}|${timestamp}|${previousMessageId}|${textHash}`);
          const legacyMessageId = dataMessageId || meta || `${meta}|${messageText.slice(0, 200)}`;
          const legacyIdentityHash = await sha256(`${direction}:${legacyMessageId}`);
          if (row.ids.includes(stableHash)) continue;
          const priorIndex = row.ids.findIndex(id => id === oldIdentityHash || id === oldFingerprintHash || id === legacyIdentityHash);
          if (priorIndex !== -1) {
            row.ids[priorIndex] = stableHash;
            days[key] = row;
            changed = true;
            continue;
          }
          row.ids.push(stableHash);
          if (!row.lastMessage || timestamp >= row.lastMessage.timestamp) {
            row.lastMessage = { hash: textHash, timestamp, direction };
          }
        } else {
          const scanKey = `${key}|${direction}|${timestamp}|${messageId}|${textHash}`;
          if (seenThisScan.has(scanKey)) continue;
          seenThisScan.add(scanKey);
          delete row.ids;
          delete row.messageHashes;
          delete row.lastMessage;
        }
        row[direction]++;
        days[key] = row;
        changed = true;
      }
      if (changed) await api.storage.local.set({ [KEY]: days });
    } finally {
      running = false;
      if (scanPending) {
        scanPending = false;
        schedule();
      }
    }
  }

  let scanPending = false;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 180); };
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-pre-plain-text', 'data-id', 'data-testid', 'class']
  });

  api.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'wcounter:scan-now') {
      schedule();
      respond({ ok: true });
      return false;
    }
    if (message?.type === 'wcounter:list-chats') {
      respond({ chats: listChats(), activeName: activeTitles()[0] || '' });
      return false;
    }
    if (message?.type === 'wcounter:diagnostics') {
      api.storage.local.get(SETTINGS).then(value => respond({
        chat: value[SETTINGS] || null,
        activeTitles: activeTitles(),
        chats: listChats().length,
        ...messageStats()
      }));
      return true;
    }
    if (message?.type === 'wcounter:select-chat') {
      api.storage.local.set({ [SETTINGS]: message.chat }).then(() => {
        const pane = document.querySelector('#pane-side');
        const rows = pane?.querySelectorAll('[data-testid="cell-frame-container"], [role="listitem"], [role="row"]') || [];
        const target = [...rows].find(node => sameName(node.querySelector('[title]')?.getAttribute('title'), message.chat.name));
        target?.click();
        setTimeout(scan, 400);
        respond({ ok: true, opened: Boolean(target) });
      });
      return true;
    }
    return false;
  });
  scan();
})();

