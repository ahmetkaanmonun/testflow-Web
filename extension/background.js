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

// Temiz oturumlu hedef sekme: izin varsa gizli pencere (A), yoksa site verisi
// temizlenmiş normal sekme (B).
async function openCleanTab(url) {
  try {
    if (await chrome.extension.isAllowedIncognitoAccess()) {
      const win = await chrome.windows.create({ url, incognito: true, focused: true });
      return { tab: win.tabs && win.tabs[0], windowId: win.id, incognito: true };
    }
  } catch (e) { console.warn('Gizli pencere açılamadı, normal sekmeye düşülüyor:', e); }
  await clearSiteData(url);
  return { tab: await chrome.tabs.create({ url }), windowId: null, incognito: false };
}

function closeTarget(s, senderTabId) {
  if (s.incognito && s.windowId != null) {
    chrome.windows.remove(s.windowId).catch(() => {});
  } else if (s.tabId != null && (senderTabId == null || senderTabId === s.tabId)) {
    chrome.tabs.remove(s.tabId).catch(() => {});
  }
}

async function notifyApp(s, message) {
  try {
    await chrome.tabs.sendMessage(s.appTabId, message);
    await chrome.tabs.update(s.appTabId, { active: true });
  } catch (e) { console.error('TestFlow sekmesine ulaşılamadı:', e); }
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

  // ===== ARAYA KAYIT =====
  // Senaryonun 1..N adımları oynatılır (sayfa doğru duruma gelsin), ardından
  // aynı sekmede kayıt başlar; kaydedilen adımlar N'den sonra eklenir.
  // N = 0 ise doğrudan başlangıç URL'inde kayda geçilir.
  if (msg.type === 'START_RECORD_FROM') {
    const { tab, windowId, incognito } = await openCleanTab(msg.startUrl);
    const base = {
      tabId: tab.id, windowId, incognito, appTabId: sender.tab.id,
      startUrl: msg.startUrl, insertContext: msg.insertContext,
    };
    if (!msg.steps || msg.steps.length === 0) {
      await setSession({ ...base, mode: 'record', steps: [] });
    } else {
      await setSession({
        ...base, mode: 'play', thenRecord: true,
        steps: msg.steps, runConfig: msg.runConfig || {},
        index: 0, results: [], startedAt: new Date().toISOString(),
      });
    }
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
    await notifyApp(s, {
      type: 'RECORDING_DONE',
      scenarioName: s.scenarioName,
      startUrl: s.startUrl,
      steps: s.steps,
      pageUrl: (sender.tab && sender.tab.url) || null, // kayıt bitirildiğindeki sayfa
      insertContext: s.insertContext || null, // doluysa: mevcut senaryoya araya ekleme
    });
    closeTarget(s, sender.tab && sender.tab.id);
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
    return { playing: true, steps: s.steps, index: s.index, runConfig: s.runConfig || {},
             pendingScript: s.pendingScript ?? null };
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
    s.pendingScript = null;
    await setSession(s);
    return { ok: true };
  }

  // Script adımı başlamadan önce işaretlenir: script sayfa geçişi başlatırsa player
  // ölür ve sonuç raporlanamaz; yeni sayfadaki player bu işareti görüp adımı
  // tamamlanmış sayar (aksi halde aynı script yeni sayfada tekrar çalışırdı).
  if (msg.type === 'SCRIPT_STARTED') {
    const s = await getSession();
    if (!s || s.mode !== 'play' || !sender.tab || sender.tab.id !== s.tabId) return { ok: false };
    s.pendingScript = msg.index;
    await setSession(s);
    return { ok: true };
  }

  // Upload adımı, sayfa dosya alanını DOM'a eklemeden kodla oluşturuyorsa: sayfanın
  // dosya penceresi açma çağrısını (input.click / showPicker) tek seferlik yakalayıp
  // pencere yerine dosyayı doğrudan o alana verir. Kullanıcı pencereden dosya seçmiş
  // gibi 'change' olayı tetiklenir. 8 sn içinde kullanılmazsa kendiliğinden kaldırılır.
  if (msg.type === 'ARM_FILE_INTERCEPT') {
    const s = await getSession();
    if (!s || s.mode !== 'play' || !sender.tab || sender.tab.id !== s.tabId) return { ok: false };
    try {
      await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: (dataUrl, fileName) => {
          const toFile = () => {
            const [head, b64] = dataUrl.split(',');
            const mime = (head.match(/data:(.*?)(;|$)/) || [])[1] || 'application/octet-stream';
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new File([bytes], fileName || 'dosya', { type: mime });
          };
          const P = HTMLInputElement.prototype;
          const origClick = P.click;
          const origPicker = P.showPicker;
          const restore = () => { P.click = origClick; if (origPicker) P.showPicker = origPicker; };
          const handle = (input) => {
            if (!input || input.type !== 'file') return false;
            const dt = new DataTransfer();
            dt.items.add(toFile());
            input.files = dt.files;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            restore();
            document.documentElement.setAttribute('data-tf-upload', 'done');
            return true;
          };
          P.click = function (...args) { if (handle(this)) return undefined; return origClick.apply(this, args); };
          if (origPicker) P.showPicker = function (...args) { if (handle(this)) return undefined; return origPicker.apply(this, args); };
          document.documentElement.removeAttribute('data-tf-upload');
          setTimeout(restore, 8000);
        },
        args: [msg.dataUrl, msg.fileName || null],
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 200) };
    }
  }

  // Kullanıcının script adımı: sayfanın kendi ortamında (MAIN world), konsoldaki
  // gibi çalışır. async desteklenir; testData ile veri setine erişilir.
  // Sonuç: { ok, value?, error? } — hata fırlatma veya false dönüşü başarısızlıktır.
  if (msg.type === 'EXEC_SCRIPT') {
    const s = await getSession();
    if (!s || s.mode !== 'play' || !sender.tab || sender.tab.id !== s.tabId) return { ok: false, error: 'Koşum oturumu yok' };
    try {
      const [inj] = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: async (code, testData, timeoutMs) => {
          const short = (v) => String(v && v.message ? v.message : v).slice(0, 300);
          const timeoutMsg = `Script ${Math.round(timeoutMs / 1000)} sn içinde bitmedi`;
          let fn;
          try {
            fn = (0, eval)('(async function (testData) {\n' + code + '\n})');
          } catch (e) {
            if (e instanceof SyntaxError) return { ok: false, error: 'Script yazım hatası: ' + short(e) };
            // Sitenin güvenlik politikası (CSP) eval'i engelledi → script etiketiyle dene
            return await new Promise((resolve) => {
              const evName = '__tf_script_' + Math.random().toString(36).slice(2);
              const onDone = (ev) => { clearTimeout(timer); document.removeEventListener(evName, onDone); resolve(ev.detail); };
              const timer = setTimeout(() => {
                document.removeEventListener(evName, onDone);
                resolve({ ok: false, error: timeoutMsg + ' ya da sitenin güvenlik politikası (CSP) script çalıştırmaya izin vermiyor.' });
              }, timeoutMs);
              document.addEventListener(evName, onDone);
              const el = document.createElement('script');
              el.textContent = '(async () => { const done = (x) => document.dispatchEvent(new CustomEvent(' +
                JSON.stringify(evName) + ', { detail: x })); try { const v = await (async function (testData) {\n' +
                code + '\n})(' + JSON.stringify(testData) + '); done({ ok: v !== false, value: v === undefined ? null : String(v).slice(0, 300) }); }' +
                ' catch (e) { done({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 300) }); } })();';
              document.documentElement.appendChild(el);
              el.remove();
            });
          }
          try {
            const v = await Promise.race([
              fn(testData),
              new Promise((_, rej) => setTimeout(() => rej(new Error(timeoutMsg)), timeoutMs)),
            ]);
            return { ok: v !== false, value: v === undefined ? null : String(v).slice(0, 300) };
          } catch (e) {
            return { ok: false, error: short(e) };
          }
        },
        args: [msg.code, msg.testData || {}, msg.timeoutMs || 30000],
      });
      return (inj && inj.result) || { ok: false, error: 'Script sonucu alınamadı' };
    } catch (e) {
      return { ok: false, error: 'Script çalıştırılamadı: ' + String(e).slice(0, 200) };
    }
  }

  if (msg.type === 'PLAY_DONE') {
    const s = await getSession();
    if (!s || s.mode !== 'play') return { ok: false };

    if (s.thenRecord) {
      const failed = s.results.find((r) => r.status === 'failed');
      if (failed) {
        // Ön adımlar geçmedi: kayda geçilmez, arayüze nedeni bildirilir
        await clearSession();
        await notifyApp(s, { type: 'RECORD_FROM_FAILED', insertContext: s.insertContext, results: s.results });
        closeTarget(s, sender.tab && sender.tab.id);
        return { ok: true };
      }
      // Aynı sekmede kayda geç: oturum record moduna döner, recorder yeniden enjekte edilir
      // (sayfa yüklenirken çalışan recorder "kayıt yok" deyip çıkmıştı)
      await setSession({
        mode: 'record', tabId: s.tabId, windowId: s.windowId, incognito: s.incognito,
        appTabId: s.appTabId, startUrl: s.startUrl, insertContext: s.insertContext, steps: [],
      });
      try {
        await chrome.scripting.executeScript({ target: { tabId: s.tabId }, files: ['recorder.js'] });
      } catch (e) { console.error('Recorder enjekte edilemedi:', e); }
      return { ok: true, recording: true };
    }

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
  if (s.insertContext) {
    try {
      await chrome.tabs.sendMessage(s.appTabId, {
        type: 'RECORD_FROM_FAILED', insertContext: s.insertContext,
        results: s.results || [], aborted: true,
      });
    } catch {}
    return;
  }
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
