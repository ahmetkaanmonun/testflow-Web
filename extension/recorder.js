// Her sayfada yüklenir; background'a "kayıtta mıyım?" diye sorar,
// evet ise dinleyicileri kurar ve durdurma çubuğunu gösterir.

(async () => {
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: 'AM_I_RECORDING' });
  } catch { return; }
  if (!response || !response.recording) return;

  let stepCount = 0;

  // ---------- Locator aday üretimi (self-healing temeli) ----------
  function cssPath(el) {
    if (!(el instanceof Element)) return null;
    const target = el;
    const parts = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE &&
           node.tagName !== 'BODY' && node.tagName !== 'HTML') {
      // Stabil (dinamik olmayan) id'li ataya demirle — yol oradan başlar
      if (node.id && !looksDynamic(node.id)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      // Her seviyede kesin konum (nth-child) — belirsiz eşleşme olmaz
      let sel = node.nodeName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const idx = [...parent.children].indexOf(node) + 1;
        sel += `:nth-child(${idx})`;
      }
      parts.unshift(sel);
      node = node.parentElement;
    }
    // Id çapası yoksa body'ye demirle (havada asılı seçici üretme)
    if (parts.length && !parts[0].startsWith('#')) parts.unshift('body');
    const path = parts.join(' > ');
    // Doğrulama: seçici kayıt anında tam olarak bu elemente çözümlenmeli;
    // çözümlenmiyorsa CSS adayı HİÇ üretilmez (yanlış aday üretmekten iyidir).
    try {
      if (path && document.querySelector(path) === target) return path;
    } catch {}
    return null;
  }

  // Dinamik (her yüklemede değişen) kimlik tespiti: framework üretimi
  // id/name'ler ("input-8342", "ember123", ":r5:", uuid, uzun sayı blokları)
  // aslında EN GÜVENİLMEZ locator'dır — skoru CSS'in de altına düşürülür.
  function looksDynamic(v) {
    if (!v) return false;
    return /\d{3,}/.test(v) ||                      // 3+ basamaklı sayı bloğu
      /^(ember|react|vue|ng|radix|mui|headlessui)[-_:]/i.test(v) ||
      /^:r[a-z0-9]+:$/i.test(v) ||                   // React useId
      /[0-9a-f]{8}-[0-9a-f]{4}/i.test(v) ||          // uuid parçası
      /(^|[-_])(\d+)([-_]|$)/.test(v);              // ayraçlı sayı
  }

  function buildCandidates(el) {
    const candidates = [];
    // Yapısal/anlamsal adaylar önce — metin EN SON çare (skoru en düşük):
    // buton/link metinleri sık değişir ("Giriş" → "Oturum Aç") ve otomasyonu kırar.
    if (el.id) candidates.push({ strategy: 'id', value: el.id, score: looksDynamic(el.id) ? 0.4 : 1.0 });
    if (el.getAttribute('data-testid'))
      candidates.push({ strategy: 'data-testid', value: el.getAttribute('data-testid'), score: 0.98 });
    if (el.name) candidates.push({ strategy: 'name', value: el.name, score: looksDynamic(el.name) ? 0.42 : 0.9 });
    if (el.getAttribute('aria-label'))
      candidates.push({ strategy: 'aria-label', value: el.getAttribute('aria-label'), score: 0.85 });
    if (el.placeholder) candidates.push({ strategy: 'placeholder', value: el.placeholder, score: 0.8 });
    // Link adresi metinden çok daha stabildir
    if (el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('href') !== '#')
      candidates.push({ strategy: 'href', value: el.getAttribute('href'), score: 0.75 });
    const css = cssPath(el);
    if (css) candidates.push({ strategy: 'css', value: css, score: 0.6 });
    const text = (el.innerText || '').trim().slice(0, 60);
    if (text && text.length >= 2 && ['BUTTON', 'A', 'LABEL', 'SPAN', 'DIV'].includes(el.tagName))
      candidates.push({ strategy: 'text', value: text, score: 0.45 });
    return candidates;
  }

  function isSensitive(el) {
    return el.type === 'password' ||
      /passw|sifre|şifre|secret|pin/i.test(el.name || '') ||
      /passw|sifre|şifre|secret|pin/i.test(el.id || '');
  }

  // ---------- İnsan-okunur etiket (doğal dil adım açıklaması için) ----------
  // Etiket KAYIT ANINDA yakalanmalı: koşum dışında element ortada yoktur.
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 60);

  function textOfIdRefs(ids) {
    return clean(String(ids || '').split(/\s+/)
      .map((id) => document.getElementById(id)?.innerText || '').join(' '));
  }

  function labelFor(el) {
    if (!el || !(el instanceof Element)) return null;
    const tag = el.tagName;
    const isField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) &&
      !['submit', 'button', 'reset', 'image'].includes(el.type);
    const aria = clean(el.getAttribute('aria-label')) || textOfIdRefs(el.getAttribute('aria-labelledby'));
    if (isField) {
      // 1) <label for="id">  2) saran <label>  3) aria  4) placeholder  5) title  6) name
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl && clean(lbl.innerText)) return clean(lbl.innerText);
      }
      const wrap = el.closest('label');
      if (wrap) {
        const copy = wrap.cloneNode(true);
        copy.querySelectorAll('input, select, textarea').forEach((n) => n.remove());
        if (clean(copy.innerText || copy.textContent)) return clean(copy.innerText || copy.textContent);
      }
      return aria || clean(el.placeholder) || clean(el.title) || clean(el.name) || null;
    }
    // Buton/link/diğer: görünen metin önce
    const text = clean(el.innerText || (['submit', 'button', 'reset'].includes(el.type) ? el.value : ''));
    if (text) return text;
    const img = el.querySelector && el.querySelector('img[alt]');
    return aria || clean(el.title) || (img && clean(img.alt)) || clean(el.name) || clean(el.id) || null;
  }

  function kindOf(el) {
    if (!el || !(el instanceof Element)) return 'element';
    const tag = el.tagName;
    const type = (el.type || '').toLowerCase();
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'field';
    if (tag === 'INPUT') {
      if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'file') return 'file';
      return 'field';
    }
    if (tag === 'BUTTON' || el.getAttribute('role') === 'button') return 'button';
    if (tag === 'A') return 'link';
    if (el.getAttribute('role') === 'option' || tag === 'LI') return 'option';
    return 'element';
  }

  // sendStep(step, el): el verilirse meta'ya label + elementKind eklenir
  async function sendStep(step, el) {
    if (el) {
      let meta = {};
      try { meta = JSON.parse(step.meta || '{}'); } catch {}
      meta.label = labelFor(el);
      meta.elementKind = kindOf(el);
      step = { ...step, meta: JSON.stringify(meta) };
    }
    stepCount += 1;
    updateBar();
    await chrome.runtime.sendMessage({ type: 'STEP', step });
  }

  // ---------- Olay dinleyicileri ----------

  let assertMode = false;

  // ---- Select2 benzeri özel dropdown'lar ----
  // Gerçek <select> gizlenir, sahte span'ler dinamik id'lidir; ham tıklamaları
  // kaydetmek koşumda kırılır. Bunun yerine seçimi, altta yatan GERÇEK select'e
  // yapılmış bir 'select' adımına çevirir, sahte elemanlara tıklamaları yok sayarız.
  function findOpenSelect2Select() {
    for (const cont of document.querySelectorAll('.select2-container--open')) {
      const prev = cont.previousElementSibling;
      if (prev && prev.tagName === 'SELECT') return prev;
    }
    const hidden = document.querySelectorAll('select.select2-hidden-accessible');
    return hidden.length === 1 ? hidden[0] : null;
  }

  function recordSelect2Choice(li) {
    const sel = findOpenSelect2Select();
    const text = (li.textContent || '').trim();
    if (!sel || !text) {
      // Çözemedik — hiç değilse ham click olarak kaydet (eski davranış)
      sendStep({
        action: 'click',
        candidates: JSON.stringify(buildCandidates(li)),
        value: null,
        sensitive: false,
        meta: JSON.stringify({ tag: 'li', via: 'select2-fallback', url: location.href }),
      }, li);
      return;
    }
    const opt = [...sel.options].find((o) => (o.text || '').trim() === text);
    sendStep({
      action: 'select',
      candidates: JSON.stringify(buildCandidates(sel)),
      value: opt ? opt.value : text,
      sensitive: false,
      meta: JSON.stringify({ tag: 'select', via: 'select2', optionText: text, url: location.href }),
    }, sel);
  }

  // Seçim mousedown anında yakalanır: dropdown henüz açık, select'e bağlanabiliriz
  document.addEventListener('mousedown', (e) => {
    if (assertMode || barEl.contains(e.target)) return;
    const li = e.target.closest('.select2-results__option');
    if (li) recordSelect2Choice(li);
  }, true);

  // Tıklama (capture fazında — preventDefault yapan sitelerde de yakalar)
  document.addEventListener('click', (e) => {
    const rawTarget = e.target;
    if (barEl.contains(rawTarget)) return; // kendi çubuğumuzu kaydetme

    // ---- Doğrulama modu: tıklanan eleman için assert adımı ekle ----
    if (assertMode) {
      e.preventDefault();
      e.stopPropagation();
      const el = rawTarget;
      const text = (el.innerText || el.value || '').trim().slice(0, 80);
      sendStep({
        action: text ? 'assert-text' : 'assert-visible',
        candidates: JSON.stringify(buildCandidates(el)),
        value: text || null,
        sensitive: false,
        meta: JSON.stringify({ tag: el.tagName.toLowerCase(), url: location.href, assertion: true }),
      }, el);
      exitAssertMode();
      return;
    }

    // Select2 arayüzü: aç/kapa ve seçenek tıklamaları kaydedilmez
    // (seçim yukarıdaki mousedown dinleyicisinde 'select' adımına çevrildi)
    if (rawTarget.closest('.select2-container, .select2-dropdown, .select2-selection, .select2-results')) return;

    let el = rawTarget.closest('button, a, input, select, [role="button"], label') || rawTarget;

    // Özel stillenmiş checkbox/radio (Bootstrap custom-control vb.):
    // görünen kutucuk LABEL'dır, gerçek input görünmezdir. Locator'ı
    // kırılgan label/CSS yerine stabil kimlikli (id/name) INPUT'tan üret.
    if (el.tagName === 'LABEL') {
      const forId = el.getAttribute('for');
      const assoc = (forId && document.getElementById(forId)) ||
                    el.querySelector('input[type="checkbox"], input[type="radio"]');
      if (assoc && (assoc.type === 'checkbox' || assoc.type === 'radio')) el = assoc;
    } else if (el === rawTarget) {
      // label'sız sarmalayıcı div'e tıklama: içindeki checkbox/radio'yu ara
      const inner = rawTarget.querySelector && rawTarget.querySelector('input[type="checkbox"], input[type="radio"]');
      if (inner) el = inner;
    }

    sendStep({
      action: 'click',
      candidates: JSON.stringify(buildCandidates(el)),
      value: null,
      sensitive: false,
      meta: JSON.stringify({ tag: el.tagName.toLowerCase(), inputType: el.type || null, url: location.href }),
    }, el);
  }, true);

  // Doğrulama modunda üzerine gelinen elemanı vurgula
  let hoverEl = null;
  document.addEventListener('mouseover', (e) => {
    if (!assertMode || barEl.contains(e.target)) return;
    if (hoverEl) hoverEl.style.outline = hoverEl.__tfOldOutline || '';
    hoverEl = e.target;
    hoverEl.__tfOldOutline = hoverEl.style.outline;
    hoverEl.style.outline = '3px solid #34c98e';
  }, true);

  function exitAssertMode() {
    assertMode = false;
    if (hoverEl) { hoverEl.style.outline = hoverEl.__tfOldOutline || ''; hoverEl = null; }
    updateAssertButton();
  }

  // Input değerleri — yazma bitince (change) kaydet, her tuşta değil.
  // Aynı elemana üst üste change gelirse önceki adımın üzerine yazılır (tekilleştirme).
  let lastFillKey = null;
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;

    // Dosya seçimi: içerik kaydedilmez (koşumda test verisinden gelir),
    // sadece upload adımı + seçilen dosyanın adı not edilir.
    // Checkbox/radio: toggle işini click adımı yapar; change'in ürettiği
    // sahte fill("on") adımı gereksiz ve yanıltıcıdır — kaydetme.
    if (el.type === 'checkbox' || el.type === 'radio') return;

    if (el.type === 'file') {
      const fileName = el.files && el.files[0] ? el.files[0].name : null;
      sendStep({
        action: 'upload',
        candidates: JSON.stringify(buildCandidates(el)),
        value: null,
        sensitive: false,
        meta: JSON.stringify({ tag: 'input', inputType: 'file', fileName, url: location.href }),
      }, el);
      return;
    }

    const sensitive = isSensitive(el);
    const fillKey = el.id || el.name || cssPath(el);
    const replacePrev = fillKey && fillKey === lastFillKey;
    lastFillKey = fillKey;
    sendStep({
      action: el.tagName === 'SELECT' ? 'select' : 'fill',
      candidates: JSON.stringify(buildCandidates(el)),
      value: sensitive ? '***' : el.value,
      sensitive,
      meta: JSON.stringify({
        tag: el.tagName.toLowerCase(), inputType: el.type || null, url: location.href,
        ...(el.tagName === 'SELECT' && el.selectedOptions[0] ? { optionText: clean(el.selectedOptions[0].text) } : {}),
      }),
      replacePrev,
    }, el);
  }, true);

  // Tıklama olunca fill zinciri kırılır (araya tıklama girdiyse yeni fill ayrı adımdır)
  document.addEventListener('click', () => { lastFillKey = null; }, true);

  // Enter tuşu: form gönderen Enter'lar adım olarak kaydedilir.
  // setTimeout(0): Enter'ın tetiklediği change (fill adımı) önce kaydedilsin,
  // press adımı ondan SONRA gelsin — koşum sırası doğru olur.
  document.addEventListener('keydown', (e) => {
    if (assertMode || barEl.contains(e.target)) return;
    if (e.key !== 'Enter') return;
    const el = e.target;
    if (!['INPUT', 'TEXTAREA'].includes(el.tagName) || el.type === 'file') return;
    const cands = JSON.stringify(buildCandidates(el));
    const meta = JSON.stringify({ tag: el.tagName.toLowerCase(), url: location.href });
    setTimeout(() => {
      sendStep({ action: 'press', candidates: cands, value: 'Enter', sensitive: false, meta }, el);
      lastFillKey = null;
    }, 0);
  }, true);

  // ---------- Kayıt çubuğu ----------
  const barEl = document.createElement('div');
  barEl.id = '__testflow_bar';
  barEl.style.cssText = `
    position: fixed; top: 12px; right: 12px; z-index: 2147483647;
    background: #181b23; color: #e6e8ee; border: 1px solid #4f7cff;
    border-radius: 10px; padding: 10px 14px; font: 13px system-ui;
    display: flex; gap: 12px; align-items: center;
    box-shadow: 0 4px 20px rgba(0,0,0,.4);
  `;
  barEl.innerHTML = `
    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f0556a;animation:__tf_pulse 1.2s infinite"></span>
    <span>TestFlow kaydediyor — <b id="__tf_count">0</b> adım</span>
    <button id="__tf_assert" style="background:#34c98e;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font:13px system-ui">✓ Doğrula</button>
    <button id="__tf_stop" style="background:#4f7cff;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font:13px system-ui">Kaydı Bitir</button>
  `;
  const style = document.createElement('style');
  style.textContent = '@keyframes __tf_pulse { 0%,100%{opacity:1} 50%{opacity:.3} }';
  document.documentElement.appendChild(style);
  document.documentElement.appendChild(barEl);

  function updateBar() {
    const el = document.getElementById('__tf_count');
    if (el) el.textContent = String(stepCount);
  }

  function updateAssertButton() {
    const btn = document.getElementById('__tf_assert');
    if (!btn) return;
    btn.textContent = assertMode ? 'Vazgeç' : '✓ Doğrula';
    btn.style.background = assertMode ? '#e8b93e' : '#34c98e';
  }

  document.getElementById('__tf_assert').addEventListener('click', (e) => {
    e.stopPropagation();
    if (assertMode) { exitAssertMode(); return; }
    assertMode = true;
    updateAssertButton();
  });

  document.getElementById('__tf_stop').addEventListener('click', async (e) => {
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  });
})();
