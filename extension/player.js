// Her sayfada yüklenir; background'a "koşumda mıyım?" diye sorar.
// Evetse kaldığı adımdan devam eder. Sayfa geçişlerinde yeniden yüklenip
// background'daki index'ten sürdüğü için navigasyonlara dayanıklıdır.

(async () => {
  let state;
  try {
    state = await chrome.runtime.sendMessage({ type: 'GET_PLAY_STATE' });
  } catch { return; }
  if (!state || !state.playing) return;

  const { steps } = state;
  const runConfig = state.runConfig || {};
  let index = state.index;

  // ---------- Koşum çubuğu ----------
  const barEl = document.createElement('div');
  barEl.style.cssText = `
    position: fixed; top: 12px; right: 12px; z-index: 2147483647;
    background: #181b23; color: #e6e8ee; border: 1px solid #34c98e;
    border-radius: 10px; padding: 10px 14px; font: 13px system-ui;
    box-shadow: 0 4px 20px rgba(0,0,0,.4);
  `;
  document.documentElement.appendChild(barEl);
  const setBar = (text) => { barEl.textContent = `▶ TestFlow koşuyor — ${text}`; };
  setBar(`adım ${index + 1}/${steps.length}`);

  // ---------- Element bulma (self-healing) ----------
  function findByCandidate(c) {
    try {
      switch (c.strategy) {
        case 'id': return document.getElementById(c.value);
        case 'data-testid': return document.querySelector(`[data-testid="${CSS.escape(c.value)}"]`);
        case 'name': return document.querySelector(`[name="${CSS.escape(c.value)}"]`);
        case 'aria-label': return document.querySelector(`[aria-label="${CSS.escape(c.value)}"]`);
        case 'placeholder': return document.querySelector(`[placeholder="${CSS.escape(c.value)}"]`);
        case 'text': {
          const nodes = [...document.querySelectorAll('button, a, label, span, div, [role="button"]')]
            .filter((n) => (n.innerText || '').trim().slice(0, 60) === c.value);
          if (nodes.length === 0) return null;
          // Öncelik: gerçekten tıklanabilir olanlar (button/a/role=button)
          const clickable = nodes.filter((n) =>
            ['BUTTON', 'A'].includes(n.tagName) || n.getAttribute('role') === 'button');
          const pool = clickable.length ? clickable : nodes;
          // En derin eşleşme: içinde başka eşleşme barındırmayan
          // (butonu saran div yerine butonun kendisi seçilir)
          return pool.find((n) => !pool.some((m) => m !== n && n.contains(m))) || pool[0];
        }
        case 'css': return document.querySelector(c.value);
        case 'href': {
          const v = String(c.value).replace(/"/g, '\\"');
          return document.querySelector(`a[href="${v}"]`);
        }
        default: return null;
      }
    } catch { return null; }
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isDisabled(el) {
    return !!(el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('fieldset[disabled]'));
  }

  // Elementin merkezi başka bir katmanın (loading overlay, modal arkası) altında mı?
  function isCovered(el) {
    let r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
      try { el.scrollIntoView({ block: 'center' }); } catch {}
      r = el.getBoundingClientRect();
    }
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top) return false; // ölçülemiyorsa engelleme
    return !(top === el || el.contains(top) || top.contains(el) ||
             (top.tagName === 'LABEL' && top.control === el));
  }

  // Bekleme koşulu: exists = DOM'da var; visible = görünür (varsayılan);
  // enabled = görünür + aktif + üstü kapalı değil (tıklanabilir).
  // Click adımlarında disabled eleman her koşulda beklenir — disabled butona
  // tıklamak hiçbir şey yapmaz, beklemek her zaman daha doğrudur.
  function isReady(el, waitFor, action) {
    if (!el) return false;
    const fileInput = el.tagName === 'INPUT' && el.type === 'file';
    if (waitFor === 'exists') return true;
    if (!isVisible(el) && !fileInput) return false;
    if (action === 'click' && isDisabled(el)) return false;
    if (waitFor === 'enabled') return !isDisabled(el) && (fileInput || !isCovered(el));
    return true;
  }

  // Adayları skorla dener; 5sn boyunca 250ms'de bir yeniden dener (sayfa yükleniyor olabilir).
  // validate: bulunan elemanın adım için uygunluğunu doğrular (yanlış elemana
  // "iyileşme" adı altında işlem yapılmasını engeller).
  async function findElement(candidates, validate, timeoutMs = 5000, waitFor = 'visible', action = null) {
    const sorted = [...candidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const deadline = Date.now() + timeoutMs;
    let seenNotReady = false; // element var ama koşul sağlanmadı (hata mesajı için)
    while (Date.now() < deadline) {
      for (let i = 0; i < sorted.length; i++) {
        const el = findByCandidate(sorted[i]);
        if (!el || (validate && !validate(el))) continue;
        if (isReady(el, waitFor, action)) {
          return { el, usedIndex: i, strategy: sorted[i].strategy };
        }
        seenNotReady = true;
      }
      await sleep(250);
    }
    return { notFound: true, seenNotReady };
  }

  // Adım türüne göre eleman doğrulayıcı üret
  function validatorFor(step) {
    let meta = {};
    try { meta = JSON.parse(step.meta || '{}'); } catch {}
    if (step.action === 'fill') {
      return (el) => {
        if (!['INPUT', 'TEXTAREA'].includes(el.tagName)) return false;
        // Kayıtta input türü biliniyorsa koşumda da aynı olmalı
        // (password adımı asla text alana yazamaz, tersi de geçerli)
        if (meta.inputType && el.tagName === 'INPUT' && el.type !== meta.inputType) return false;
        return true;
      };
    }
    if (step.action === 'select') {
      return (el) => el.tagName === 'SELECT';
    }
    if (step.action === 'upload') {
      return (el) => el.tagName === 'INPUT' && el.type === 'file';
    }
    return null; // click/assert: tür kısıtı yok
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Gerçek kullanıcı tıklamasını taklit eder: bazı siteler click yerine
  // pointer/mouse olaylarını dinler, salt el.click() onlarda işe yaramaz.
  function realisticClick(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    try { el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, isPrimary: true })); } catch {}
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    try { el.focus(); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, isPrimary: true })); } catch {}
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    // KRİTİK: click, dispatchEvent ile DEĞİL el.click() ile.
    // Sentetik dispatch edilen click olayları linklerin varsayılan davranışını
    // (href izleme, javascript: çalıştırma) tetiklemez — yalnızca el.click()
    // metodu aktivasyon davranışını çalıştırır. dispatchEvent kullanılınca
    // <a href="javascript:submitform(...)"> gibi linklerde tıklama "yapılmış"
    // görünür ama hiçbir şey olmazdı.
    el.click();
  }

  function setNativeValue(el, value) {
    // React/Vue kontrollü inputlar için native setter kullan
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT'
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---------- Adım çalıştırma ----------
  // Koşulan adımın tanımının kopyası: senaryo sonradan değişse de geçmiş koşum okunur.
  // Koşumdaki adımların value'su test veri setinden çözülmüş olabilir — hassas veya
  // veri setine bağlı adımlarda değer ASLA snapshot'a yazılmaz.
  function snapshotOf(step) {
    let target = null;
    let bindingKey = null;
    try {
      const cands = JSON.parse(step.candidates || '[]');
      if (cands.length) target = { strategy: cands[0].strategy, value: String(cands[0].value).slice(0, 200) };
    } catch {}
    try { if (step.dataBinding) bindingKey = JSON.parse(step.dataBinding).dataSetKey ?? null; } catch {}
    let meta = null;
    try { meta = JSON.parse(step.meta || '{}'); } catch {}
    const hideValue = step.sensitive || !!step.dataBinding;
    return JSON.stringify({
      action: step.action,
      target,
      value: hideValue ? null : (step.value ?? null),
      dataBindingKey: bindingKey,
      sensitive: !!step.sensitive,
      meta,
    });
  }

  // Hata mesajları için adımın hedefini doğal dille an: "'Giriş Yap' butonu"
  // (frontend/src/lib/describe.js ile aynı sözlük — eklenti oradan import edemez)
  const KIND_NOM = { button: 'butonu', link: 'bağlantısı', field: 'alanı', file: 'dosya alanı',
    select: 'listesi', checkbox: 'onay kutusu', radio: 'seçeneği', option: 'seçeneği', element: 'öğesi' };
  const KIND_BARE = { button: 'Buton', link: 'Bağlantı', field: 'Alan', file: 'Dosya alanı',
    select: 'Liste', checkbox: 'Onay kutusu', radio: 'Seçenek', option: 'Seçenek', element: 'Öğe' };
  function targetName(step) {
    let meta = {};
    try { meta = JSON.parse(step.meta || '{}'); } catch {}
    let kind = meta.elementKind;
    if (!kind) {
      kind = step.action === 'fill' || step.action === 'press' ? 'field'
        : step.action === 'select' ? 'select' : step.action === 'upload' ? 'file' : 'element';
    }
    let label = meta.label;
    if (!label) {
      try {
        const c = JSON.parse(step.candidates || '[]')[0];
        if (c && ['aria-label', 'placeholder', 'text', 'name', 'id', 'data-testid'].includes(c.strategy)) label = c.value;
      } catch {}
    }
    label = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 50);
    return label ? `'${label}' ${KIND_NOM[kind] || 'öğesi'}` : (KIND_BARE[kind] || 'Öğe');
  }
  const secs = (ms) => String(Math.round(ms / 100) / 10).replace('.', ',');

  function resultBase(stepIndex, step) {
    return { orderIndex: stepIndex, stepId: step.id ?? null, stepSnapshot: snapshotOf(step) };
  }

  // Adım zamanlaması (epoch ms): startedAt = adım başladı, locatedAt = element
  // bulundu (bekleme bitti), finishedAt = sonuç raporlandı. Click/press sonucu
  // aksiyondan ÖNCE raporlandığı için onlarda finishedAt aksiyon anıdır.
  let timing = { startedAt: null, locatedAt: null };

  // reportResult: sonucu background'a yazar (index ilerler)
  async function reportResult(stepIndex, step, result) {
    await chrome.runtime.sendMessage({
      type: 'STEP_RESULT',
      result: {
        ...resultBase(stepIndex, step),
        startedAt: timing.startedAt,
        locatedAt: timing.locatedAt,
        finishedAt: Date.now(),
        ...result,
      },
    });
  }

  // Bekleme süresi önceliği: adım (meta.timeoutMs) → koşum varsayılanı (senaryo →
  // ortam → proje, arayüzde çözülür) → 5 sn. Adımda açıkça süre verilmediyse
  // eski oranlar korunur: doğrulama adımları 2,4 kat (5→12 sn; sayfa geçişi
  // sonrasına denk gelirler), opsiyonel adımlar 0,6 kat (5→3 sn; gelmeyen
  // modallar koşumu bekletmesin).
  function resolveWait(step, optional) {
    let meta = {};
    try { meta = JSON.parse(step.meta || '{}'); } catch {}
    const clamp = (ms) => Math.min(Math.max(ms, 500), 60000);
    const waitFor = ['exists', 'visible', 'enabled'].includes(meta.waitFor) ? meta.waitFor : 'visible';
    const own = Number(meta.timeoutMs);
    if (own > 0) return { timeoutMs: clamp(own), waitFor };
    const base = Number(runConfig.defaultTimeoutMs) > 0 ? Number(runConfig.defaultTimeoutMs) : 5000;
    const factor = step.action.startsWith('assert') ? 2.4 : (optional ? 0.6 : 1);
    return { timeoutMs: clamp(Math.round(base * factor)), waitFor };
  }

  async function captureScreenshot() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'CAPTURE' });
      return res?.screenshot || null;
    } catch { return null; }
  }

  async function executeStep(step, stepIndex) {
    timing = { startedAt: Date.now(), locatedAt: null };
    // Opsiyonel adım: başarısızlık koşumu kesmez, 'skipped' olarak geçilir
    // (bazı kayıtlarda alan dolu/kilitli gelir veya hiç görünmez).
    let optional = false;
    let ifEmpty = false;
    try {
      const m = JSON.parse(step.meta || '{}');
      optional = !!m.optional;
      ifEmpty = !!m.ifEmpty;
    } catch {}
    const failStatus = optional ? 'skipped' : 'failed';
    const failPrefix = optional ? 'Opsiyonel adım atlandı — ' : '';

    // goto: adrese git — element gerektirmez. Rapor ÖNCE (navigasyon script'i öldürür);
    // yeni sayfada player kaldığı index'ten devam eder.
    if (step.action === 'goto') {
      let url;
      try { url = new URL(String(step.value || '').trim(), location.href).href; } catch {}
      if (!url) {
        const r = { status: failStatus, healed: false, errorMessage: failPrefix + `Geçersiz adres: "${step.value}"` };
        await reportResult(stepIndex, step, r);
        return r;
      }
      const r = { status: 'passed', healed: false, healedStrategy: null };
      await reportResult(stepIndex, step, r);
      const current = location.href;
      const hashOnly = url !== current && url.split('#')[0] === current.split('#')[0];
      if (url === current) location.reload();
      else location.href = url;
      // Gerçek sayfa geçişinde script ölür; o arada döngü ilerlemesin.
      // Yalnız hash değiştiyse sayfa yenilenmez, beklemeden devam edilir.
      if (!hashOnly) await sleep(10000);
      return r;
    }

    // wait: element gerektirmez — belirtilen saniye kadar bekle (üst sınır 60sn)
    if (step.action === 'wait') {
      const secs = Math.min(Math.max(parseFloat(step.value) || 1, 0.1), 60);
      await sleep(secs * 1000);
      const r = { status: 'passed', healed: false, healedStrategy: null };
      await reportResult(stepIndex, step, r);
      return r;
    }

    const candidates = JSON.parse(step.candidates || '[]');
    const { timeoutMs, waitFor } = resolveWait(step, optional);
    const found = await findElement(candidates, validatorFor(step), timeoutMs, waitFor, step.action);
    if (found.notFound) {
      const why = found.seenNotReady
        ? (waitFor === 'enabled' ? 'tıklanabilir hale gelmedi (pasif veya üstü başka bir katmanla kapalı)'
                                 : 'ekranda görünür hale gelmedi')
        : 'ekranda bulunamadı';
      const r = { status: failStatus, healed: false,
        errorMessage: failPrefix + `${targetName(step)} ${secs(timeoutMs)} sn içinde ${why}. ` +
          '(Tüm locator adayları denendi; türü uymayan eşleşmeler reddedildi.)',
        screenshot: await captureScreenshot() };
      await reportResult(stepIndex, step, r);
      return r;
    }
    timing.locatedAt = Date.now();
    const healed = found.usedIndex > 0;
    const healedStrategy = healed ? found.strategy : null;

    try {
      if (step.action === 'click') {
        found.el.scrollIntoView({ block: 'center' });
        await sleep(100);
        // ÖNEMLİ: sonucu TIKLAMADAN ÖNCE raporla. Tıklama sayfa geçişi
        // başlatırsa bu script ölür ve rapor kaybolur; yeni sayfada aynı
        // adım tekrar aranıp yanlış fail üretirdi.
        const r = { status: 'passed', healed, healedStrategy, screenshot: await captureScreenshot() };
        await reportResult(stepIndex, step, r);

        // javascript: href'li link mi? Sentetik click bu URL'leri çalıştıramaz
        // (tarayıcının user-activation şartı) — kodu background üzerinden
        // sayfanın MAIN dünyasında doğrudan çalıştırırız.
        const href = found.el.tagName === 'A' ? (found.el.getAttribute('href') || '').trim() : '';
        if (href.toLowerCase().startsWith('javascript:')) {
          // Olay zinciri yine gönderilir (mousedown dinleyen handler'lar için)
          realisticClick(found.el);
          await chrome.runtime.sendMessage({
            type: 'EXEC_JS_HREF',
            code: href.slice('javascript:'.length),
          });
        } else {
          realisticClick(found.el);
        }
        return r;
      } else if (step.action === 'fill') {
        if (step.value === '***' || step.value == null) {
          const first = candidates[0] ? `${candidates[0].strategy}=${candidates[0].value}` : 'bilinmiyor';
          const r = { status: failStatus, healed, healedStrategy, screenshot: await captureScreenshot(),
                   errorMessage: failPrefix + `Gizli/boş değer (eleman: ${first}) — senaryoda bu adımı 📎 ile bir test verisi anahtarına bağlayıp Kaydet'e basın. Not: aynı alan için birden fazla fill adımı oluşmuş olabilir, fazlasını silin.` };
          await reportResult(stepIndex, step, r);
          return r;
        }
        if (ifEmpty) {
          const locked = found.el.disabled || found.el.readOnly;
          const current = String(found.el.value ?? '').trim();
          if (locked || current) {
            const r = { status: 'skipped', healed, healedStrategy, screenshot: await captureScreenshot(),
                     errorMessage: locked
                       ? 'Alan kilitli (disabled/readonly) geldi — boşsa-doldur gereği dokunulmadı.'
                       : 'Alan zaten dolu geldi — boşsa-doldur gereği mevcut değer korundu.' };
            await reportResult(stepIndex, step, r);
            return r;
          }
        }
        found.el.focus();
        setNativeValue(found.el, step.value);
        const r = { status: 'passed', healed, healedStrategy, screenshot: await captureScreenshot() };
        await reportResult(stepIndex, step, r);
        return r;
      } else if (step.action === 'select') {
        let via = null;
        try { via = JSON.parse(step.meta || '{}').via; } catch {}
        if (ifEmpty) {
          const locked = found.el.disabled;
          const current = String(found.el.value ?? '').trim();
          if (locked || current) {
            const r = { status: 'skipped', healed, healedStrategy, screenshot: await captureScreenshot(),
                     errorMessage: locked
                       ? 'Seçim alanı kilitli (disabled) geldi — boşsa-doldur gereği dokunulmadı.'
                       : 'Seçim alanı zaten dolu geldi — boşsa-doldur gereği mevcut seçim korundu.' };
            await reportResult(stepIndex, step, r);
            return r;
          }
        }
        setNativeValue(found.el, step.value);
        if (via === 'select2') {
          // Select2 uygulamaları satır ekleme gibi işleri jQuery'ye özel
          // olaylara (select2:select) bağlar; native change onları görmez.
          // Sayfanın kendi dünyasında jQuery olaylarını da tetikleriz.
          found.el.setAttribute('data-tf-s2', '1');
          await chrome.runtime.sendMessage({
            type: 'EXEC_JS_HREF',
            code: `(function(){var el=document.querySelector('[data-tf-s2]');if(!el)return;el.removeAttribute('data-tf-s2');if(window.jQuery){var $el=window.jQuery(el);try{$el.trigger('change');}catch(e){}try{var d=($el.select2&&$el.select2('data'))||[];$el.trigger({type:'select2:select',params:{data:d[0]||{id:el.value}}});}catch(e){}}})();`,
          });
          await sleep(400); // tetiklenen satır ekleme vb. için kısa nefes
        }
        const r = { status: 'passed', healed, healedStrategy, screenshot: await captureScreenshot() };
        await reportResult(stepIndex, step, r);
        return r;
      } else if (step.action === 'upload') {
        if (!step.value || !String(step.value).startsWith('data:')) {
          const r = { status: failStatus, healed, healedStrategy, screenshot: await captureScreenshot(),
                   errorMessage: failPrefix + 'Dosya içeriği yok — bu adımı dosya tipli bir test verisi anahtarına 📎 ile bağlayın.' };
          await reportResult(stepIndex, step, r);
          return r;
        }
        // dataURL → File → input.files (Playwright setInputFiles'ın tarayıcı içi karşılığı)
        const [head, b64] = String(step.value).split(',');
        const mime = (head.match(/data:(.*?)(;|$)/) || [])[1] || 'application/octet-stream';
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let bi = 0; bi < bin.length; bi++) bytes[bi] = bin.charCodeAt(bi);
        const file = new File([bytes], step.fileName || 'dosya', { type: mime });
        const dt = new DataTransfer();
        dt.items.add(file);
        found.el.files = dt.files;
        found.el.dispatchEvent(new Event('input', { bubbles: true }));
        found.el.dispatchEvent(new Event('change', { bubbles: true }));
        const r = { status: 'passed', healed, healedStrategy, screenshot: await captureScreenshot() };
        await reportResult(stepIndex, step, r);
        return r;
      } else if (step.action === 'press') {
        const key = (step.value || 'Enter').trim() || 'Enter';
        // Rapor ÖNCE: Enter form submit'i tetikleyip sayfayı değiştirebilir
        const r = { status: 'passed', healed, healedStrategy, screenshot: await captureScreenshot() };
        await reportResult(stepIndex, step, r);
        found.el.focus();
        const kOpts = { key, code: key, bubbles: true, cancelable: true };
        const notPrevented = found.el.dispatchEvent(new KeyboardEvent('keydown', kOpts));
        found.el.dispatchEvent(new KeyboardEvent('keyup', kOpts));
        // Native davranış taklidi: site keydown'ı yutmadıysa ve alan bir
        // formdaysa Enter form submit'i demektir (sentetik tuş bunu tetiklemez)
        if (key === 'Enter' && notPrevented && found.el.form) {
          try { found.el.form.requestSubmit(); }
          catch { try { found.el.form.submit(); } catch {} }
        }
        return r;
      } else if (step.action === 'assert-visible') {
        // Element bulunduysa (findElement görünürlük kontrolü yapıyor) geçer
        const r = { status: 'passed', healed, healedStrategy, screenshot: await captureScreenshot() };
        await reportResult(stepIndex, step, r);
        return r;
      } else if (step.action === 'assert-text') {
        const expected = (step.value || '').trim();
        // SPA/menü geçişlerinde element hemen bulunur ama içeriği gecikmeli
        // değişir ("İş Listesi" → "Dosya Listeleme" gibi). Bu yüzden elementi
        // ve metni BİRLİKTE, süre dolana dek yeniden kontrol ederiz — sayfa
        // yeniden render edilse bile her turda taze element üzerinden bakılır.
        const deadline = Date.now() + timeoutMs;
        let lastActual = (found.el.innerText || found.el.value || '').trim();
        let lastHealed = healed;
        let lastStrategy = healedStrategy;
        while (Date.now() < deadline) {
          if (expected && lastActual.includes(expected)) {
            const r = { status: 'passed', healed: lastHealed, healedStrategy: lastStrategy,
                        screenshot: await captureScreenshot() };
            await reportResult(stepIndex, step, r);
            return r;
          }
          await sleep(400);
          const again = await findElement(candidates, validatorFor(step), 600, waitFor, step.action);
          if (!again.notFound) {
            lastActual = (again.el.innerText || again.el.value || '').trim();
            lastHealed = again.usedIndex > 0;
            lastStrategy = lastHealed ? again.strategy : null;
          }
        }
        const r = { status: failStatus, healed: lastHealed, healedStrategy: lastStrategy,
                 screenshot: await captureScreenshot(),
                 errorMessage: failPrefix + `${targetName(step)} beklenen metni içermiyor. Beklenen: "${expected.slice(0,80)}", ekranda görünen: "${lastActual.slice(0,80)}"` };
        await reportResult(stepIndex, step, r);
        return r;
      } else {
        const r = { status: 'skipped', healed: false, errorMessage: `Desteklenmeyen aksiyon: ${step.action}` };
        await reportResult(stepIndex, step, r);
        return r;
      }
    } catch (e) {
      const r = { status: failStatus, healed, healedStrategy, errorMessage: failPrefix + String(e).slice(0, 300) };
      await reportResult(stepIndex, step, r);
      return r;
    }
  }

  // ---------- Ana döngü ----------
  while (index < steps.length) {
    const step = steps[index];
    setBar(`adım ${index + 1}/${steps.length}: ${targetName(step)} (${step.action})`);

    const result = await executeStep(step, index); // sonuç executeStep içinde raporlanır

    if (result.status === 'failed') {
      // Kalan adımları skipped işaretle
      for (let j = index + 1; j < steps.length; j++) {
        await chrome.runtime.sendMessage({
          type: 'STEP_RESULT',
          result: { ...resultBase(j, steps[j]), status: 'skipped', healed: false },
        });
      }
      break;
    }

    index += 1;
    // Tıklama navigasyona yol açtıysa bu script ölür; yeni sayfada player
    // yeniden yüklenir ve background'daki index'ten devam eder.
    await sleep(400);
  }

  setBar('tamamlandı, sonuçlar gönderiliyor…');
  const done = await chrome.runtime.sendMessage({ type: 'PLAY_DONE' });
  if (done && done.recording) barEl.remove(); // araya kayıt: aynı sekmede kayıt başladı
})();
