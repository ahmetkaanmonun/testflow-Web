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
  // Önceki sayfada başlayan script adımı sayfa geçişi yaptı: o adım tamamlandı sayılır
  if (state.pendingScript != null && state.pendingScript === index && steps[index]) {
    let snap = null;
    try { snap = JSON.stringify({ action: 'script', target: null, value: null, dataBindingKey: null, sensitive: false,
                                  meta: JSON.parse(steps[index].meta || '{}') }); } catch {}
    await chrome.runtime.sendMessage({
      type: 'STEP_RESULT',
      result: { orderIndex: index, stepId: steps[index].id ?? null, stepSnapshot: snap, status: 'passed', healed: false,
                finishedAt: Date.now(), errorMessage: 'Not: script sayfa geçişi başlattı; adım tamamlandı sayıldı.' },
    });
    index += 1;
  }

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

  // Tarayıcının gerçekten tıklamayı engellediği durum: yerel form elemanında disabled.
  function isNativelyDisabled(el) {
    return !!(el.disabled || (el.closest('fieldset[disabled]') && 'disabled' in el));
  }
  // Daha geniş tanım (aria-disabled dahil) — yalnız "tıklanabilir olsun" koşulunda.
  // Bazı arayüz kütüphaneleri tıklanabilir elemanlarda da aria-disabled bırakır;
  // varsayılan modda buna bakmak, elle çalışan adımı boşuna bekletiyordu.
  function isDisabled(el) {
    return isNativelyDisabled(el) || el.getAttribute('aria-disabled') === 'true';
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
    if (action === 'click' && isNativelyDisabled(el)) return false;
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
      value: hideValue ? null : (step.value == null ? null : String(step.value).slice(0, 500)),
      dataBindingKey: bindingKey,
      sensitive: !!step.sensitive,
      meta,
      ...(loopCtx ? { iteration: loopCtx.iteration, iterations: loopCtx.total } : {}),
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
  // Tekrar bloğu içindeyken { iteration (1'den), total } — rapor ve snapshot'a yazılır
  let loopCtx = null;

  // reportResult: sonucu background'a yazar (index ilerler)
  async function reportResult(stepIndex, step, result) {
    // Tekrar bloğu içindeki başarısızlıkta hangi satırda olduğu mesajın başına yazılır
    if (loopCtx && result.status !== 'passed' && result.errorMessage && !result.errorMessage.startsWith('Not: ')) {
      result = { ...result, errorMessage: `${loopCtx.iteration}. satırda: ${result.errorMessage}` };
    }
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

  // ---------- Formu toplu doldur: yardımcılar ----------
  const norm = (t) => String(t || '').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();

  // Seçeneğin kullanıcıya görünen etiketi
  function optionLabel(el) {
    if (el.tagName === 'OPTION') return el.text || el.value || '';
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && l.innerText.trim()) return l.innerText.trim();
    }
    const wrap = el.closest('label');
    if (wrap && wrap.innerText.trim()) return wrap.innerText.trim();
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    if (el.getAttribute('role') === 'radio' && el.innerText.trim()) return el.innerText.trim();
    let n = el.nextSibling;
    while (n && !String(n.textContent || '').trim()) n = n.nextSibling;
    if (n && String(n.textContent || '').trim()) return String(n.textContent).trim().slice(0, 80);
    return el.value || '';
  }

  // Görünür mü — özel tasarımlı radyolarda input gizlidir, etiketi görünür
  function shownOrLabelShown(el) {
    if (isVisible(el)) return true;
    const lbl = el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
    return !!(lbl && isVisible(lbl));
  }

  // Sayfadaki seçenekli sorular: [{ kind: 'radio'|'select', options: [el], el? }]
  function collectQuestions() {
    const out = [];
    const byName = new Map();
    for (const r of document.querySelectorAll('input[type="radio"]')) {
      if (r.disabled || !shownOrLabelShown(r)) continue;
      const key = r.name ? `name:${r.form ? 'f' : ''}${r.name}` : r;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(r);
    }
    for (const opts of byName.values()) out.push({ kind: 'radio', options: opts });
    const byGroup = new Map();
    for (const r of document.querySelectorAll('[role="radio"]')) {
      if (r.tagName === 'INPUT' || !isVisible(r) || r.getAttribute('aria-disabled') === 'true') continue;
      const g = r.closest('[role="radiogroup"]') || r.parentElement;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(r);
    }
    for (const opts of byGroup.values()) out.push({ kind: 'radio', options: opts });
    for (const sel of document.querySelectorAll('select')) {
      if (sel.disabled || sel.multiple) continue;
      // select2 gibi bileşenler asıl select'i gizler; yanındaki görünür bileşen yeterli
      const proxy = sel.nextElementSibling;
      if (!isVisible(sel) && !(proxy && /select2|chosen/.test(proxy.className || '') && isVisible(proxy))) continue;
      const options = [...sel.options].filter((o) => !o.disabled && o.value !== '');
      if (options.length) out.push({ kind: 'select', el: sel, options });
    }
    return out;
  }

  function collectTextFields() {
    return [...document.querySelectorAll('textarea, input:not([type]), input[type="text"]')]
      .filter((el) => isVisible(el) && !el.disabled && !el.readOnly);
  }

  function pickOption(options, choice) {
    if (choice.mode === 'random') return options[Math.floor(Math.random() * options.length)];
    if (choice.mode === 'index') {
      const n = parseInt(choice.value, 10) || 1;
      return n > 0 ? options[n - 1] : options[options.length + n]; // -1 = son seçenek
    }
    const want = norm(choice.value);
    if (!want) return null;
    return options.find((o) => norm(optionLabel(o)) === want)
        || options.find((o) => norm(optionLabel(o)).includes(want));
  }

  const isChosen = (o) => !!o.checked || o.getAttribute('aria-checked') === 'true' || !!o.selected;

  function randomText() {
    const words = ['Otomasyon', 'test', 'yorumu', 'örnek', 'değerlendirme', 'kontrol', 'notu'];
    const pick = () => words[Math.floor(Math.random() * words.length)];
    return `${pick()} ${pick()} ${Math.floor(1000 + Math.random() * 9000)}`;
  }

  async function fillForm(cfg, step, timeoutMs, failStatus, failPrefix) {
    const choice = cfg.choice || { mode: 'none' };
    const text = cfg.text || { mode: 'none' };
    const onlyEmpty = cfg.onlyEmpty !== false;
    // Sayfa yüklenirken alanlar geç gelebilir: en az bir hedef görünene kadar bekle
    const deadline = Date.now() + timeoutMs;
    let questions = [], fields = [];
    while (Date.now() < deadline) {
      questions = choice.mode !== 'none' ? collectQuestions() : [];
      fields = text.mode !== 'none' ? collectTextFields() : [];
      if (questions.length || fields.length) break;
      await sleep(250);
    }
    timing.locatedAt = Date.now();
    if (!questions.length && !fields.length) {
      return { status: failStatus, healed: false, screenshot: await captureScreenshot(),
               errorMessage: failPrefix + `${secs(timeoutMs)} sn içinde sayfada doldurulacak soru veya metin alanı bulunamadı.` };
    }

    let marked = 0, alreadySet = 0;
    const unmatched = [];
    for (const q of questions) {
      if (onlyEmpty && q.options.some(isChosen) && !(q.kind === 'select' && q.el.selectedIndex <= 0)) { alreadySet++; continue; }
      const opt = pickOption(q.options, choice);
      if (!opt) { unmatched.push(q); continue; }
      if (q.kind === 'select') {
        setNativeValue(q.el, opt.value);
      } else {
        const target = isVisible(opt) ? opt
          : (opt.closest('label') || (opt.id && document.querySelector(`label[for="${CSS.escape(opt.id)}"]`)) || opt);
        target.scrollIntoView({ block: 'center' });
        realisticClick(target);
      }
      marked++;
      await sleep(60); // arayüz tepki versin (koşullu sorular, doğrulama)
    }

    let filled = 0;
    if (text.mode !== 'none') {
      // Seçim yapılınca yeni yorum alanları açılmış olabilir — yeniden topla
      for (const f of collectTextFields()) {
        if (onlyEmpty && String(f.value || '').trim()) continue;
        const v = text.mode === 'random' ? randomText() : String(step.value ?? '');
        if (!v) continue;
        f.scrollIntoView({ block: 'center' });
        try { f.focus(); } catch {}
        setNativeValue(f, v);
        f.dispatchEvent(new Event('blur', { bubbles: true }));
        filled++;
        await sleep(30);
      }
    }

    const summary = [
      choice.mode !== 'none' ? `${marked} soru işaretlendi` : null,
      alreadySet ? `${alreadySet} soru zaten cevaplıydı` : null,
      text.mode !== 'none' ? `${filled} metin alanı dolduruldu` : null,
    ].filter(Boolean).join(', ');

    if (unmatched.length) {
      const what = choice.mode === 'index' ? `${choice.value}. seçenek` : `'${choice.value}' seçeneği`;
      return { status: failStatus, healed: false, screenshot: await captureScreenshot(),
               errorMessage: failPrefix + `${questions.length} sorudan ${unmatched.length} tanesinde ${what} bulunamadı. (${summary})` };
    }
    return { status: 'passed', healed: false, screenshot: await captureScreenshot(), errorMessage: `Not: ${summary}.` };
  }

  // ---------- Tekrar bloğu: satır bulma ----------
  // Durum sınıfları (seçili, tek/çift satır…) satırlar arasında farklılaşır; otomatik
  // üretilen sınıflar her derlemede değişir. İkisi de benzerlik karşılaştırmasında yok sayılır.
  const STATE_CLASS = /(^|[-_])(active|selected|hover|focus|focused|odd|even|open|opened|expanded|collapsed|checked|current|highlight|highlighted|disabled)($|[-_])|^(is|has)-/i;
  const HASHY_CLASS = /^(css|sc|jss|emotion)-|[a-z]*\d[a-z0-9]{4,}$|__[A-Za-z0-9]{5,}$/;
  const stableClasses = (el) => [...el.classList].filter((c) => !STATE_CLASS.test(c) && !HASHY_CLASS.test(c));

  function similarTo(ref) {
    const cls = stableClasses(ref);
    return (el) => el.tagName === ref.tagName &&
      cls.every((c) => el.classList.contains(c)) &&
      Math.abs(el.childElementCount - ref.childElementCount) <= 1;
  }

  // Kardeşler alt alta mı dizili (satır) yoksa yan yana mı (hücre/sütun)?
  function stackedVertically(els) {
    const tops = new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)));
    return tops.size >= Math.min(els.length, 2) && tops.size > els.length / 2;
  }

  // anchor: kayıtta ilk satırda tıklanan element. Dönen: { rows, rowEl, path }
  function discoverRows(anchor) {
    const candidatesUp = [];
    // Açık satır yapıları öncelikli: tablo satırı, ARIA satırı, liste elemanı
    for (const sel of ['tr', '[role="row"]', 'li']) {
      const r = anchor.closest(sel);
      if (r && !candidatesUp.includes(r)) candidatesUp.push(r);
    }
    for (let cur = anchor; cur && cur.parentElement && cur !== document.body; cur = cur.parentElement) {
      if (!candidatesUp.includes(cur)) candidatesUp.push(cur);
    }
    for (const rowEl of candidatesUp) {
      const parent = rowEl.parentElement;
      if (!parent) continue;
      const rows = [...parent.children].filter((x) => similarTo(rowEl)(x) && isVisible(x));
      if (rows.length >= 2 && (rowEl.tagName === 'TR' || rowEl.getAttribute('role') === 'row' || stackedVertically(rows))) {
        // satırdan hedefe giden yol (çocuk sırası + etiket) — diğer satırlarda aynı hedefi bulmak için
        const path = [];
        for (let n = anchor; n !== rowEl; n = n.parentElement) {
          path.unshift({ idx: [...n.parentElement.children].indexOf(n), tag: n.tagName });
        }
        return { rows, rowEl, path, anchorTag: anchor.tagName, anchorClasses: stableClasses(anchor) };
      }
    }
    return null;
  }

  function targetInRow(row, info) {
    let n = row;
    for (const p of info.path) {
      const next = n.children[p.idx];
      if (!next || next.tagName !== p.tag) { n = null; break; }
      n = next;
    }
    if (n) return n;
    // Yapı küçük farklılık gösteriyorsa: satır içinde aynı tür ve sınıftaki ilk element
    const sel = info.anchorTag.toLowerCase() + info.anchorClasses.map((c) => '.' + CSS.escape(c)).join('');
    return row.querySelector(sel) || row;
  }

  async function captureScreenshot() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'CAPTURE' });
      return res?.screenshot || null;
    } catch { return null; }
  }

  async function executeStep(step, stepIndex, opts = {}) {
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

    // ---------- Formu toplu doldur ----------
    if (step.action === 'fill-form') {
      let cfg = {};
      try { cfg = JSON.parse(step.meta || '{}').form || {}; } catch {}
      const r = await fillForm(cfg, step, resolveWait(step, optional).timeoutMs, failStatus, failPrefix);
      await reportResult(stepIndex, step, r);
      return r;
    }

    // ---------- Script çalıştır ----------
    if (step.action === 'script') {
      const code = String(step.value || '');
      if (!code.trim()) {
        const r = { status: failStatus, healed: false, errorMessage: failPrefix + 'Script boş.' };
        await reportResult(stepIndex, step, r);
        return r;
      }
      let own = 0;
      try { own = Number(JSON.parse(step.meta || '{}').timeoutMs) || 0; } catch {}
      await chrome.runtime.sendMessage({ type: 'SCRIPT_STARTED', index: stepIndex });
      const res = await chrome.runtime.sendMessage({
        type: 'EXEC_SCRIPT', code, testData: runConfig.testData || {}, timeoutMs: own > 0 ? Math.min(own, 300000) : 30000,
      });
      const r = res && res.ok
        ? { status: 'passed', healed: false, screenshot: await captureScreenshot(),
            ...(res.value != null && res.value !== 'true' ? { errorMessage: `Not: script sonucu: ${res.value}` } : {}) }
        : { status: failStatus, healed: false, screenshot: await captureScreenshot(),
            errorMessage: failPrefix + ((res && res.error) || 'Script false döndürdü.') };
      await reportResult(stepIndex, step, r);
      return r;
    }

    const candidates = JSON.parse(step.candidates || '[]');
    const { timeoutMs, waitFor } = resolveWait(step, optional);
    const found = opts.overrideEl
      ? { el: opts.overrideEl, usedIndex: 0, strategy: 'satır' } // tekrar bloğu: o turun satırındaki hedef
      : await findElement(candidates, validatorFor(step), timeoutMs, waitFor, step.action);
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

  // ---------- Tekrar bloğu ----------
  function matchingEnd(startIdx) {
    let depth = 0;
    for (let j = startIdx + 1; j < steps.length; j++) {
      if (steps[j].action === 'repeat-start') depth++;
      if (steps[j].action === 'repeat-end') { if (depth === 0) return j; depth--; }
    }
    return -1;
  }

  // Döngü sonucunu döner: { status } — failed ise koşum durur
  async function runRepeat(startIdx) {
    const start = steps[startIdx];
    timing = { startedAt: Date.now(), locatedAt: null };
    const endIdx = matchingEnd(startIdx);
    const fail = async (msg, at = startIdx) => {
      const r = { status: 'failed', healed: false, errorMessage: msg, screenshot: await captureScreenshot() };
      await reportResult(at, steps[at], r);
      return { status: 'failed', endIdx: endIdx < 0 ? steps.length - 1 : endIdx, failedAt: at };
    };
    if (endIdx < 0) return fail('Tekrar bloğunun sonu yok — bloğu bitiren "repeat-end" adımını ekleyin.');
    const body = [];
    for (let j = startIdx + 1; j < endIdx; j++) body.push(j);
    const first = steps[body[0]];
    if (!first || !JSON.parse(first.candidates || '[]').length) {
      return fail('Tekrar bloğunun ilk adımı, ilk satırda tıklanan bir element olmalı (kayıtla eklenmiş bir click adımı).');
    }
    if (body.some((j) => steps[j].action === 'repeat-start')) return fail('İç içe tekrar blokları henüz desteklenmiyor.');

    let cfg = {};
    try { cfg = JSON.parse(start.meta || '{}').repeat || {}; } catch {}
    const skip = Math.max(parseInt(cfg.skip, 10) || 0, 0);
    const max = parseInt(cfg.max, 10) > 0 ? parseInt(cfg.max, 10) : Infinity;

    // Satırları, ilk adımın (kayıttaki ilk satır) elementinden yola çıkarak bul
    const locate = async () => {
      const { timeoutMs } = resolveWait(first, false);
      const f = await findElement(JSON.parse(first.candidates), validatorFor(first), timeoutMs, 'visible', first.action);
      return f.notFound ? null : discoverRows(f.el);
    };
    const info0 = await locate();
    timing.locatedAt = Date.now();
    if (!info0) return fail(`${targetName(first)} bulunamadı ya da çevresinde tekrarlanan satır yapısı tespit edilemedi.`);
    const total = Math.min(Math.max(info0.rows.length - skip, 0), max);
    if (total === 0) return fail(`${info0.rows.length} satır bulundu, atlama ayarından sonra işlenecek satır kalmadı.`);
    await reportResult(startIdx, start, { status: 'passed', healed: false,
      errorMessage: `Not: ${info0.rows.length} satır bulundu, ${total} tanesi işlenecek.` });

    for (let it = 0; it < total; it++) {
      loopCtx = { iteration: it + 1, total };
      setBar(`tekrar ${it + 1}/${total}`);
      // Her turda satırlar yeniden bulunur: önceki işlem tabloyu yeniden çizmiş olabilir
      const info = it === 0 ? info0 : await locate();
      const row = info && info.rows[skip + it];
      if (!row) {
        const r = await fail(`${info ? info.rows.length : 0} satır kaldı; ${skip + it + 1}. satır artık yok (işlenen satırlar listeden kalkıyor olabilir).`, body[0]);
        loopCtx = null;
        return r;
      }
      row.scrollIntoView({ block: 'center' });
      for (let k = 0; k < body.length; k++) {
        const j = body[k];
        setBar(`tekrar ${it + 1}/${total} — adım ${k + 1}/${body.length}: ${targetName(steps[j])}`);
        const res = await executeStep(steps[j], j, k === 0 ? { overrideEl: targetInRow(row, info) } : {});
        if (res.status === 'failed') { loopCtx = null; return { status: 'failed', endIdx, failedAt: j }; }
        await sleep(400);
      }
    }
    loopCtx = null;
    timing = { startedAt: Date.now(), locatedAt: null };
    await reportResult(endIdx, steps[endIdx], { status: 'passed', healed: false, errorMessage: `Not: ${total} satır işlendi.` });
    return { status: 'passed', endIdx };
  }

  async function skipRest(from) {
    for (let j = from; j < steps.length; j++) {
      await chrome.runtime.sendMessage({
        type: 'STEP_RESULT',
        result: { ...resultBase(j, steps[j]), status: 'skipped', healed: false },
      });
    }
  }

  // Tekrar bloğunun içindeki bir adım sayfa değiştirdiyse döngü durumu kaybolur:
  // kaldığı yerden "düz" devam etmek yanlış olurdu, açıkça başarısız sayılır.
  {
    let open = -1;
    for (let j = 0; j < index && j < steps.length; j++) {
      if (steps[j].action === 'repeat-start') open = j;
      if (steps[j].action === 'repeat-end') open = -1;
    }
    if (open >= 0 && index < steps.length) {
      await reportResult(index, steps[index], { status: 'failed', healed: false,
        errorMessage: 'Tekrar bloğunun içindeki bir adım sayfa değiştirdi. Tekrar blokları şu an aynı sayfada kalmalı (modal, panel gibi).' });
      await skipRest(index + 1);
      index = steps.length;
    }
  }

  // ---------- Ana döngü ----------
  while (index < steps.length) {
    const step = steps[index];

    if (step.action === 'repeat-start') {
      const res = await runRepeat(index);
      if (res.status === 'failed') {
        // Bloğun kalanı ve sonrası atlandı
        const after = (res.failedAt ?? index) + 1;
        await skipRest(after);
        break;
      }
      index = res.endIdx + 1;
      await sleep(400);
      continue;
    }
    if (step.action === 'repeat-end') { // eşleşmeyen bitiş: zararsız, geç
      await reportResult(index, step, { status: 'passed', healed: false });
      index += 1;
      continue;
    }

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
