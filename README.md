# WCounter

Estensione leggera per Chrome e Firefox. Seleziona una chat dalla lista di WhatsApp Web e registra separatamente messaggi inviati e ricevuti, con totale giornaliero e storico.

## Installazione

- **Chrome:** `chrome://extensions` → modalità sviluppatore → **Carica estensione non pacchettizzata** → seleziona questa cartella.
- **Firefox:** `about:debugging#/runtime/this-firefox` → **Carica componente aggiuntivo temporaneo** → seleziona `manifest.json`.

Ricarica WhatsApp Web dopo aver caricato l’estensione. Apri il popup WCounter, aggiorna la lista e scegli la chat. Quando scegli una chat, l'estensione la apre automaticamente. Per registrare nuovi messaggi, lasciala aperta in WhatsApp Web.

## Limiti

I messaggi vengono letti dal contenuto già caricato da WhatsApp Web. Per questo i messaggi precedenti non caricati non compaiono finché WhatsApp non carica quella parte della cronologia. I dati restano localmente nel browser; nessun server e nessuna dipendenza esterna. WhatsApp può cambiare il markup interno e richiedere aggiornamenti dell’estensione.

