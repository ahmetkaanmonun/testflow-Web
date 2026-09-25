// Oturum durumu: { mode: 'record'|'play', ... }
// Service worker uyuyabildiği için chrome.storage.session'da tutulur.

// Gizli pencere açılamadığında (şirket politikası vb.) B planı:
// hedef sitenin çerez/oturum verilerini temizleyerek temiz başlangıç sağla.
async function clearSiteData(url) {
  try {
    const origin = new URL(url).origin;
    await chrome.browsingData.remove({ origins: [origin] }, {
      cookies: true,
      localStorage: true,
      cacheStorage: true,
      indexedDB: true,
      serviceWorkers: true,
    });
    console.log('Temiz oturum: site verileri temizlendi →', origin);
    return true;
  } catch (e) {
    console.warn('Site verisi temizlenemedi:', e);
    return false;
  }
}

async function getSession() {
  const { session } = await chrome.storage.session.get('session');
  return session || null;
}
async function setSession(session) {
  await chrome.storage.session.set({ session });
}
async function clearSession() {
  await chrome.storage.session.remove('session');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse);
  return true;
});

async function handle(msg, sender) {
  // ===== KAYIT =====
  if (msg.type === 'START_RECORDING') {
    // Koşumla simetri: kayıt da (izin varsa) gizli pencerede, temiz oturumla.
    // Böylece "kayıtta login'liydim, koşumda değildim" tutarsızlığı oluşmaz.
    let tab = null;
    let windowId = null;
    let incognito = false;
    try {
      if (await chrome.extension.isAllowedIncognitoAccess()) {
        const win = await chrome.windows.create({ url: msg.startUrl, incognito: true, focused: true });
        tab = win.tabs && win.tabs[0];
        windowId = win.id;
        incognito = true;
      }
    } catch (e) { console.warn('Gizli pencere açılamadı, normal sekmeye düşülüyor:', e); }
    if (!tab) {
      await clearSiteData(msg.startUrl); // B planı: normal sekme ama temiz oturum
      tab = await chrome.tabs.create({ url: msg.startUrl });
    }
    await setSession({
      mode: 'record',
      tabId: tab.id,
      windowId,
      incognito,
      appTabId: sender.tab.id,
      scenarioName: msg.scenarioName,
      startUrl: msg.startUrl,
      steps: [],
    });
    return { ok: true };
  }

  if (msg.type === 'AM_I_RECORDING') {
    const s = await getSession();
    return { recording: !!s && s.mode === 'record' && sender.tab && sender.tab.id === s.tabId };
  }

  if (msg.type === 'STEP') {
    const s = await getSession();
    if (!s || s.mode !== 'record' || !sender.tab || sender.tab.id !== s.tabId) return { ok: false };
    const { replacePrev, ...step } = msg.step;
    if (replacePrev && s.steps.length > 0 &&
        ['fill', 'select'].includes(s.steps[s.steps.length - 1].action)) {
      s.steps[s.steps.length - 1] = step; // aynı alana ardışık yazım → üzerine yaz
    } else {
      s.steps.push(step);
    }
    await setSession(s);
    return { ok: true, count: s.steps.length };
  }

  if (msg.type === 'STOP_RECORDING') {
    const s = await getSession();
    if (!s || s.mode !== 'record') return { ok: false };
    await clearSession();
    try {
      await chrome.tabs.sendMessage(s.appTabId, {
        type: 'RECORDING_DONE',
        scenarioName: s.scenarioName,
        startUrl: s.startUrl,
        steps: s.steps,
      });
      await chrome.tabs.update(s.appTabId, { active: true });
    } catch (e) { console.error('TestFlow sekmesine ulaşılamadı:', e); }
    if (s.incognito && s.windowId != null) {
      chrome.windows.remove(s.windowId).catch(() => {});
    } else if (sender.tab && sender.tab.id === s.tabId) {
      chrome.tabs.remove(s.tabId);
    }
    return { ok: true };
  }

  // ===== KOŞUM =====
  if (msg.type === 'START_RUN') {
    // Temiz oturum: izin verildiyse gizli pencerede koş (önceki koşumun
    // login çerezleri taşınmaz, kullanıcının normal oturumları etkilenmez).
    let tab = null;
    let windowId = null;
    let incognito = false;
    try {
      if (await chrome.extension.isAllowedIncognitoAccess()) {
        const win = await chrome.windows.create({ url: msg.startUrl, incognito: true, focused: true });
        tab = win.tabs && win.tabs[0];
        windowId = win.id;
        incognito = true;
      }
    } catch (e) { console.warn('Gizli pencere açılamadı, normal sekmeye düşülüyor:', e); }
    if (!tab) {
      await clearSiteData(msg.startUrl); // B planı: normal sekme ama temiz oturum
      tab = await chrome.tabs.create({ url: msg.startUrl });
    }
    await setSession({
      mode: 'play',
      tabId: tab.id,
      windowId,
      incognito,
      appTabId: sender.tab.id,
      startUrl: msg.startUrl,
      steps: msg.steps,
      runContext: msg.runContext,
      runConfig: msg.runConfig || {},
      index: 0,
      results: [],
      startedAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  // player.js sayfa yüklenince sorar: koşuyor muyum, kaldığım yer neresi?
  if (msg.type === 'GET_PLAY_STATE') {
    const s = await getSession();
    if (!s || s.mode !== 'play' || !sender.tab || sender.tab.id !== s.tabId) return { playing: false };
    return { playing: true, steps: s.steps, index: s.index, runConfig: s.runConfig || {} };
  }

  // player.js: javascript: href'li linklerin kodunu sayfanın kendi
  // dünyasında (MAIN world) çalıştır. Sentetik click'ler javascript:
  // URL navigasyonunu tetikleyemez (user-activation şartı); doğrudan
  // çalıştırma bu şarta takılmaz.
  if (msg.type === 'EXEC_JS_HREF') {
    const s = await getSession();
    if (!s || s.mode !== 'play' || !sender.tab || sender.tab.id !== s.tabId) return { ok: false };
    try {
      await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: (code) => {
          try {
            (0, eval)(code);
          } catch (e) {
            // CSP eval'i engelliyorsa script etiketiyle dene
            // (javascript: href çalışan sitede inline script de çalışır)
            const el = document.createElement('script');
            el.textContent = code;
            document.documentElement.appendChild(el);
            el.remove();
          }
        },
        args: [msg.code],
      });
      return { ok: true };
    } catch (e) {
      console.error('EXEC_JS_HREF hatası:', e);
      return { ok: false, error: String(e) };
    }
  }

  // player.js adım öncesi ekran görüntüsü ister
  if (msg.type === 'CAPTURE') {
    const s = await getSession();
    if (!s || s.mode !== 'play' || !sender.tab || sender.tab.id !== s.tabId) return { screenshot: null };
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'jpeg', quality: 50 });
      return { screenshot: dataUrl };
    } catch (e) {
      return { screenshot: null }; // kota/izin sorunu — görüntüsüz devam
    }
  }

  // player.js her adım sonucunu bildirir
  if (msg.type === 'STEP_RESULT') {
    const s = await getSession();
    if (!s || s.mode !== 'play' || !sender.tab || sender.tab.id !== s.tabId) return { ok: false };
    s.results.push(msg.result);
    s.index = msg.result.orderIndex + 1;
    await setSession(s);
    return { ok: true };
  }

  if (msg.type === 'PLAY_DONE') {
    const s = await getSession();
    if (!s || s.mode !== 'play') return { ok: false };
    await clearSession();
    try {
      await chrome.tabs.sendMessage(s.appTabId, {
        type: 'RUN_DONE',
        runContext: s.runContext,
        startedAt: s.startedAt,
        finishedAt: new Date().toISOString(),
        results: s.results,
      });
      await chrome.tabs.update(s.appTabId, { active: true });
    } catch (e) { console.error('TestFlow sekmesine ulaşılamadı:', e); }
    if (s.incognito && s.windowId != null) {
      chrome.windows.remove(s.windowId).catch(() => {});
    } else if (sender.tab && sender.tab.id === s.tabId) {
      chrome.tabs.remove(s.tabId);
    }
    return { ok: true };
  }

  return { ok: false };
}

// Sekme elle kapatılırsa: koşumdaysa yarım sonuçla bitir, kayıttaysa iptal
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = await getSession();
  if (!s || s.tabId !== tabId) return;
  await clearSession();
  if (s.mode === 'play') {
    try {
      await chrome.tabs.sendMessage(s.appTabId, {
        type: 'RUN_DONE',
        runContext: s.runContext,
        startedAt: s.startedAt,
        finishedAt: new Date().toISOString(),
        results: s.results,
        aborted: true,
      });
    } catch {}
  }
});
