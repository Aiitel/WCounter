(() => {
  const api = globalThis.browser || globalThis.chrome;
  const KEY = 'wcounter:days';
  const SETTINGS = 'wcounter:selectedChat';
  const status = document.getElementById('status');
  const fileInput = document.getElementById('backup-file');
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  async function returnToWhatsApp() {
    const params = new URLSearchParams(location.search);
    const sourceId = Number(params.get('returnTab'));
    let target = null;
    if (Number.isInteger(sourceId) && sourceId > 0) {
      try {
        const source = await api.tabs.get(sourceId);
        if (source.url?.startsWith('https://web.whatsapp.com/')) target = source;
      } catch {}
    }
    if (!target) {
      const matches = await api.tabs.query({ url: 'https://web.whatsapp.com/*' });
      target = matches.find(tab => tab.active) || matches[0] || null;
    }
    if (!target) {
      target = await api.tabs.create({ url: 'https://web.whatsapp.com/', active: true });
    } else {
      await api.tabs.update(target.id, { active: true });
      try { await api.windows.update(target.windowId, { focused: true }); } catch {}
    }
    const current = await api.tabs.getCurrent();
    if (current?.id) await api.tabs.remove(current.id);
  }

  fileInput.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    status.textContent = 'Lettura del backup…';
    try {
      const backup = JSON.parse(await file.text());
      if (backup?.format !== 'wcounter-backup' || backup.version !== 1 || !backup.days || typeof backup.days !== 'object' || Array.isArray(backup.days)) {
        throw new Error('Formato di backup non riconosciuto.');
      }
      const incomingRows = Object.entries(backup.days).map(([key, row]) => {
        if (!row || typeof row !== 'object' || typeof row.chatId !== 'string' || typeof row.day !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !Number.isFinite(Number(row.sent)) || !Number.isFinite(Number(row.received))) {
          throw new Error('Il backup contiene una giornata con dati non validi.');
        }
        return [key, {
          ...row,
          sent: Number(row.sent), received: Number(row.received),
          ids: Array.isArray(row.ids) ? row.ids : [],
          messageHashes: Array.isArray(row.messageHashes) ? row.messageHashes : []
        }];
      });
      if (!incomingRows.length) throw new Error('Il backup non contiene giornate da ripristinare.');

      const current = (await api.storage.local.get([KEY, SETTINGS]));
      const merged = { ...(current[KEY] || {}) };
      for (const [key, incoming] of incomingRows) {
        const existing = merged[key];
        if (!existing) {
          incoming.ids = [...new Set([...incoming.ids, ...incoming.messageHashes])];
          delete incoming.messageHashes;
          merged[key] = incoming;
          continue;
        }
        merged[key] = {
          ...existing,
          ...incoming,
          sent: Math.max(Number(existing.sent) || 0, incoming.sent),
          received: Math.max(Number(existing.received) || 0, incoming.received),
          ids: [...new Set([...(Array.isArray(existing.ids) ? existing.ids : []), ...incoming.ids])],
          messageHashes: [...new Set([...(Array.isArray(existing.messageHashes) ? existing.messageHashes : []), ...incoming.messageHashes])]
        };
        merged[key].ids = [...new Set([...merged[key].ids, ...merged[key].messageHashes])];
        delete merged[key].messageHashes;
        if (existing.lastMessage?.timestamp > (incoming.lastMessage?.timestamp || '')) merged[key].lastMessage = existing.lastMessage;
      }

      const importedChats = new Map(incomingRows.map(([, row]) => [row.chatId, { id: row.chatId, name: row.chatName || row.chatId }]));
      for (const row of Object.values(merged)) {
        if (row.day !== today()) {
          delete row.ids;
          delete row.messageHashes;
          delete row.lastMessage;
        }
      }
      const selected = current[SETTINGS];
      const nextSelected = selected && importedChats.has(selected.id) ? selected : importedChats.values().next().value;
      await api.storage.local.set({ [KEY]: merged, [SETTINGS]: nextSelected });
      status.textContent = `Ripristino completato: ${importedChats.size} chat, ${incomingRows.length} giornate. Lo storico è stato unito ai dati locali.`;
      await returnToWhatsApp();
    } catch (error) {
      status.textContent = error?.message || 'Impossibile leggere il file di backup.';
    } finally {
      event.target.value = '';
    }
  });
})();
