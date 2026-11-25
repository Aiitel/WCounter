(() => {
  const api = globalThis.browser || globalThis.chrome;
  const KEY = 'wcounter:days';
  const SETTINGS = 'wcounter:selectedChat';
  const $ = id => document.getElementById(id);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  $('today-date').textContent = new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(now);
  let tabId;
  let selected = null;
  let chatById = new Map();
  let calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  let focusedDay = '';
  let currentRows = [];

  async function getTab() {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    tabId = tabs[0]?.id;
    if (!tabId || !tabs[0]?.url?.startsWith('https://web.whatsapp.com/')) {
      $('chat-select').innerHTML = '<option value="">WhatsApp Web non attivo</option>';
      return false;
    }
    return true;
  }
  const send = message => api.tabs.sendMessage(tabId, message);

  async function refreshChats() {
    if (!await getTab()) return;
    try {
      const [result, saved] = await Promise.all([
        send({ type: 'wcounter:list-chats' }),
        api.storage.local.get(SETTINGS)
      ]);
      selected = saved[SETTINGS] || null;
      chatById = new Map(result.chats.map(chat => [chat.id, chat]));
      const select = $('chat-select');
      select.replaceChildren();
      if (!result.chats.length) {
        select.add(new Option('Nessuna chat rilevata', ''));
      } else {
        select.add(new Option('Seleziona una chat…', ''));
        for (const chat of result.chats) select.add(new Option(chat.name, chat.id));
        if (selected && chatById.has(selected.id)) select.value = selected.id;
      }
      await render();
    } catch {}
  }

  $('chat-select').addEventListener('change', async event => {
    const chat = chatById.get(event.target.value);
    if (!chat) { selected = null; await render(); return; }
    selected = chat;
    await api.storage.local.set({ [SETTINGS]: selected });
    try {
      const result = await send({ type: 'wcounter:select-chat', chat: selected });
    } catch {}
    await render();
  });

  async function render() {
    const storage = await api.storage.local.get(KEY);
    const allDays = storage[KEY] || {};
    const rows = Object.values(allDays).filter(row => selected && row.chatId === selected.id).sort((a, b) => b.day.localeCompare(a.day));
    currentRows = rows;
    const todayRow = rows.find(row => row.day === today);
    const sent = todayRow?.sent || 0;
    const received = todayRow?.received || 0;
    $('sent-count').textContent = sent;
    $('received-count').textContent = received;
    $('today-count').textContent = sent + received;
    $('rows').replaceChildren();
    $('empty').classList.toggle('hidden', rows.length > 0);
    for (const rowData of rows) {
      const row = document.createElement('div'); row.className = `row${focusedDay === rowData.day ? ' focused' : ''}`; row.dataset.day = rowData.day;
      const date = document.createElement('span');
      date.textContent = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${rowData.day}T12:00:00Z`));
      const sentCount = document.createElement('span'); sentCount.textContent = rowData.sent || 0;
      const receivedCount = document.createElement('span'); receivedCount.textContent = rowData.received || 0;
      const total = document.createElement('strong'); total.textContent = (rowData.sent || 0) + (rowData.received || 0);
      row.append(date, sentCount, receivedCount, total); $('rows').append(row);
    }
    renderCalendar(rows);
    if (focusedDay) document.querySelector(`.row[data-day="${focusedDay}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  function renderCalendar(rows) {
    const grid = $('calendar-grid');
    grid.replaceChildren();
    $('month-label').textContent = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(calendarMonth);
    for (const label of ['L', 'M', 'M', 'G', 'V', 'S', 'D']) {
      const weekday = document.createElement('span'); weekday.className = 'calendar-weekday'; weekday.textContent = label; grid.append(weekday);
    }
    const year = calendarMonth.getFullYear(), month = calendarMonth.getMonth();
    const offset = (new Date(year, month, 1).getDay() + 6) % 7;
    for (let i = 0; i < offset; i++) { const blank = document.createElement('span'); blank.className = 'calendar-blank'; grid.append(blank); }
    const countByDay = new Map(rows.map(row => [row.day, (row.sent || 0) + (row.received || 0)]));
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const total = countByDay.get(dateKey) || 0;
      const button = document.createElement('button');
      button.type = 'button'; button.className = `calendar-day${total ? ' has-count' : ''}${focusedDay === dateKey ? ' selected-day' : ''}`;
      button.setAttribute('aria-label', `${day}: ${total} messaggi`);
      const dayNumber = document.createElement('span'); dayNumber.textContent = day;
      const count = document.createElement('small'); count.textContent = total;
      button.append(dayNumber, count);
      button.addEventListener('click', () => {
        focusedDay = dateKey;
        $('calendar').classList.add('hidden');
        $('calendar-toggle').setAttribute('aria-expanded', 'false');
        render();
      });
      grid.append(button);
    }
  }
  $('calendar-toggle').addEventListener('click', () => {
    const open = $('calendar').classList.toggle('hidden') === false;
    $('calendar-toggle').setAttribute('aria-expanded', String(open));
    if (open) renderCalendar(currentRows);
  });
  $('month-prev').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1); renderCalendar(currentRows); });
  $('month-next').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1); renderCalendar(currentRows); });
  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== button.dataset.tab));
  }));
  function openBackupDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('wcounter-file-backup', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('handles');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function rememberBackupHandle(handle) {
    const db = await openBackupDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('handles', 'readwrite');
      transaction.objectStore('handles').put(handle, 'backup');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }
  async function syncBackupFile() {
    return api.runtime.sendMessage({ type: 'wcounter:sync-file' });
  }
  async function safeBackupDays(source) {
    const result = {};
    const hash = async value => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    };
    for (const [key, row] of Object.entries(source || {})) {
      result[key] = {
        chatId: row.chatId, chatName: row.chatName, day: row.day,
        sent: Number(row.sent) || 0, received: Number(row.received) || 0,
        ids: await Promise.all((Array.isArray(row.ids) ? row.ids : []).map(id => /^[a-f0-9]{64}$/i.test(id) ? id : hash(id))),
        ...(row.lastMessage && /^[a-f0-9]{64}$/i.test(row.lastMessage.hash || '') ? { lastMessage: row.lastMessage } : {})
      };
    }
    return result;
  }
  $('export-history').addEventListener('click', async () => {
    const status = $('backup-status');
    try {
      if (typeof window.showSaveFilePicker !== 'function') {
        status.textContent = 'Questo browser non supporta il collegamento automatico a un file. Usa Chrome o un browser Chromium; qui non è stato scaricato nulla.';
        return;
      }
      const handle = await window.showSaveFilePicker({
        suggestedName: 'wcounter-storico.json',
        types: [{ description: 'Backup WCounter (JSON)', accept: { 'application/json': ['.json'] } }]
      });
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') throw new Error('Autorizzazione negata');
      await rememberBackupHandle(handle);
      const synced = await syncBackupFile();
      if (!synced?.ok) throw new Error('Sincronizzazione non riuscita');
      status.textContent = 'File collegato e sincronizzato. Si aggiornerà a ogni messaggio contato.';
    } catch (error) {
      status.textContent = error?.name === 'AbortError' ? 'Salvataggio annullato.' : 'Impossibile salvare il backup.';
    }
  });
  $('manual-export').addEventListener('click', async () => {
    const status = $('backup-status');
    try {
      const stored = await api.storage.local.get(KEY);
      const days = await safeBackupDays(stored[KEY]);
      const blob = new Blob([JSON.stringify({ format: 'wcounter-backup', version: 1, exportedAt: new Date().toISOString(), days }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'wcounter-storico.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = 'Copia esportata; questo pulsante non attiva la sincronizzazione automatica.';
    } catch {
      status.textContent = 'Impossibile esportare il backup.';
    }
  });
  $('import-history').addEventListener('click', () => $('history-file').click());
  $('history-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const status = $('backup-status');
    try {
      const data = JSON.parse(await file.text());
      if (data?.format !== 'wcounter-backup' || data.version !== 1 || !data.days || typeof data.days !== 'object' || Array.isArray(data.days)) {
        throw new Error('Formato non valido');
      }
      if (!confirm('Il ripristino sostituirà lo storico presente nell’estensione. Vuoi continuare?')) return;
      await api.storage.local.set({ [KEY]: data.days });
      status.textContent = 'Storico ripristinato dal file.';
      await render();
    } catch {
      status.textContent = 'File non valido o impossibile da leggere.';
    } finally {
      event.target.value = '';
    }
  });
  $('refresh').addEventListener('click', refreshChats);
  refreshChats();
})();
