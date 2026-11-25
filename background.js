(() => {
  const api = globalThis.browser || globalThis.chrome;
  const DATA_KEY = 'wcounter:days';
  const DB_NAME = 'wcounter-file-backup';
  const STORE = 'handles';
  let writeQueue = Promise.resolve();

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function getHandle() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get('backup');
      request.onsuccess = () => { db.close(); resolve(request.result || null); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }
  async function hashLegacyId(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function backupDays(source) {
    const result = {};
    for (const [key, row] of Object.entries(source || {})) {
      const ids = Array.isArray(row.ids) ? await Promise.all(row.ids.map(id => /^[a-f0-9]{64}$/i.test(id) ? id : hashLegacyId(id))) : [];
      result[key] = {
        chatId: row.chatId,
        chatName: row.chatName,
        day: row.day,
        sent: Number(row.sent) || 0,
        received: Number(row.received) || 0,
        ids,
        messageHashes: Array.isArray(row.messageHashes) ? row.messageHashes.filter(hash => /^[a-f0-9]{64}$/i.test(hash)) : [],
        ...(row.lastMessage && /^[a-f0-9]{64}$/i.test(row.lastMessage.hash || '') ? {
          lastMessage: {
            hash: row.lastMessage.hash,
            timestamp: String(row.lastMessage.timestamp || ''),
            direction: row.lastMessage.direction === 'sent' ? 'sent' : 'received'
          }
        } : {})
      };
    }
    return result;
  }
  async function saveBackup() {
    const handle = await getHandle();
    if (!handle) return;
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      await api.storage.local.set({ 'wcounter:backupStatus': 'permission-needed' });
      return;
    }
    const data = await api.storage.local.get(DATA_KEY);
    const days = await backupDays(data[DATA_KEY]);
    const payload = JSON.stringify({
      format: 'wcounter-backup', version: 1,
      exportedAt: new Date().toISOString(),
      days
    }, null, 2);
    const writable = await handle.createWritable();
    await writable.write(payload);
    await writable.close();
    await api.storage.local.set({ 'wcounter:backupStatus': 'synced' });
  }
  function queueBackup() {
    const task = writeQueue.then(saveBackup);
    writeQueue = task.catch(async error => {
      console.error('WCounter backup sync failed', error);
      await api.storage.local.set({ 'wcounter:backupStatus': 'error' });
    });
    return task;
  }
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[DATA_KEY]) queueBackup().catch(() => {});
  });
  api.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'wcounter:sync-file') {
      queueBackup().then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
      return true;
    }
  });
})();
