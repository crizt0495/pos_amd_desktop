'use strict';

/**
 * Preload KasirPro POS.
 *
 *  - Menyediakan jembatan `window.kasirproDesktop` untuk halaman lokal
 *    (setup/owner/offline) maupun halaman web POS.
 *  - Menambal `window.print()` di MAIN WORLD halaman web supaya struk dicetak
 *    langsung ke printer thermal (silent print) tanpa dialog, dan halaman
 *    popup (Export PDF) tetap memakai dialog bawaan.
 *  - Meneruskan lagi tombol F5 (Pending) yang dicegat main process.
 */

const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('kasirproDesktop', {
  platform: 'desktop',
  version: () => ipcRenderer.invoke('desktop:version'),
  submitSerial: (serial) => ipcRenderer.invoke('desktop:submit-serial', String(serial || '')),
  owner: (payload) => ipcRenderer.invoke('desktop:owner', payload || {}),
  retry: () => ipcRenderer.invoke('desktop:retry'),
  print: () => ipcRenderer.invoke('desktop:print'),
  reportStoreName: (name) => ipcRenderer.send('desktop:store-name', String(name || '')),
  notifyOffline: () => ipcRenderer.send('desktop:offline'),
  openOwner: () => ipcRenderer.send('desktop:open-owner'),
  quit: () => ipcRenderer.send('desktop:quit'),
});

/** Kode yang dieksekusi di main world halaman (akses DOM sebenarnya). */
const MAIN_WORLD_PATCH = `
(() => {
  if (window.__kproPrintPatched) return;
  window.__kproPrintPatched = true;

  const bridge = () => window.kasirproDesktop;
  const origPrint = (typeof window.print === 'function') ? window.print.bind(window) : function () {};

  window.print = function () {
    try {
      const href = String(location.href || '');
      const isPopup = location.protocol === 'about:' || href.indexOf('about:') === 0 || href === 'about:blank';
      const isReceipt = !!document.querySelector('.receipt, .receipt-print');
      const b = bridge();
      if (!isPopup && isReceipt && b && b.print) {
        b.print();
        return;
      }
    } catch (e) { /* lanjut ke dialog bawaan */ }
    return origPrint();
  };

  if (!window.__kproNetHooked) {
    window.__kproNetHooked = true;
    window.addEventListener('offline', () => {
      try { bridge() && bridge().notifyOffline(); } catch (e) {}
    });
    window.addEventListener('online', () => {
      try { bridge() && bridge().retry(); } catch (e) {}
    });
  }
})();
`;

function patchMainWorld() {
  try {
    webFrame.executeJavaScript(MAIN_WORLD_PATCH, false);
  } catch (e) {
    /* abaikan */
  }
}

patchMainWorld();
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', patchMainWorld);
} else {
  patchMainWorld();
}

// F5 (Pending) yang dicegat main process diteruskan kembali ke halaman.
ipcRenderer.on('desktop:replay-key', (_e, key) => {
  try {
    webFrame.executeJavaScript(
      `try{ document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(String(key))},bubbles:true,cancelable:true})); }catch(e){}`,
      false,
    );
  } catch (e) {
    /* abaikan */
  }
});
