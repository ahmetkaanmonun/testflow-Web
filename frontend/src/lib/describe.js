// Adımları doğal dille (Türkçe) anlatır.
// Hem senaryo adımı ({action, candidates, value, dataBinding, sensitive, meta})
// hem koşum snapshot'ı ({action, target, value, dataBindingKey, sensitive, meta})
// kabul edilir.
//
// Türkçe ek uyumu etikete değil öğe türüne bağlanır ("'Giriş Yap' butonuna"),
// böylece etiket ne olursa olsun ekler doğru kalır.

const KINDS = {
  button:   { nom: 'butonu',       dat: 'butonuna',       gen: 'butonunun',       loc: 'butonunda',       abl: 'butonundan' },
  link:     { nom: 'bağlantısı',   dat: 'bağlantısına',   gen: 'bağlantısının',   loc: 'bağlantısında',   abl: 'bağlantısından' },
  field:    { nom: 'alanı',        dat: 'alanına',        gen: 'alanının',        loc: 'alanında',        abl: 'alanından' },
  file:     { nom: 'dosya alanı',  dat: 'dosya alanına',  gen: 'dosya alanının',  loc: 'dosya alanında',  abl: 'dosya alanından' },
  select:   { nom: 'listesi',      dat: 'listesine',      gen: 'listesinin',      loc: 'listesinde',      abl: 'listesinden' },
  checkbox: { nom: 'onay kutusu',  dat: 'onay kutusuna',  gen: 'onay kutusunun',  loc: 'onay kutusunda',  abl: 'onay kutusundan' },
  radio:    { nom: 'seçeneği',     dat: 'seçeneğine',     gen: 'seçeneğinin',     loc: 'seçeneğinde',     abl: 'seçeneğinden' },
  option:   { nom: 'seçeneği',     dat: 'seçeneğine',     gen: 'seçeneğinin',     loc: 'seçeneğinde',     abl: 'seçeneğinden' },
  element:  { nom: 'öğesi',        dat: 'öğesine',        gen: 'öğesinin',        loc: 'öğesinde',        abl: 'öğesinden' },
};

const clip = (t, n = 50) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

function parse(json, fallback) {
  if (json == null) return fallback;
  if (typeof json === 'object') return json;
  try { return JSON.parse(json); } catch { return fallback; }
}

// Kayıtta etiket yakalanmamış (eski) adımlar için locator'dan kaba tahmin
function labelFromTarget(target) {
  if (!target) return null;
  const readable = ['aria-label', 'placeholder', 'text', 'name', 'data-testid', 'id'];
  if (readable.includes(target.strategy)) return clip(target.value, 40);
  return null;
}

function kindFallback(action, meta) {
  if (action === 'fill' || action === 'press') return 'field';
  if (action === 'select') return 'select';
  if (action === 'upload') return 'file';
  if (meta?.tag === 'button') return 'button';
  if (meta?.tag === 'a') return 'link';
  if (meta?.inputType === 'checkbox') return 'checkbox';
  if (meta?.inputType === 'radio') return 'radio';
  return 'element';
}

/** Adım/snapshot'ı ortak şekle getirir. */
export function normalizeStep(step) {
  const meta = parse(step.meta, {}) || {};
  let target = step.target || null;
  if (!target && step.candidates) {
    const cands = parse(step.candidates, []);
    if (Array.isArray(cands) && cands.length) {
      target = [...cands].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    }
  }
  let bindingKey = step.dataBindingKey ?? null;
  if (!bindingKey && step.dataBinding) bindingKey = parse(step.dataBinding, {})?.dataSetKey ?? null;
  return {
    action: step.action,
    meta,
    target,
    value: step.value,
    sensitive: !!step.sensitive,
    bindingKey,
  };
}

// Değerin anlatımı: sabit değer, gizli değer veya test verisi referansı
function valuePhrase(n) {
  if (n.bindingKey) return { text: `test verisindeki '${n.bindingKey}' değerini`, known: true };
  if (n.sensitive || n.value === '***') return { text: 'gizli değeri', known: true };
  if (n.value == null || n.value === '') return { text: 'boş değer', known: false };
  return { text: `'${clip(n.value, 40)}' değerini`, known: true };
}

/**
 * Adımın otomatik üretilmiş Türkçe açıklaması (kullanıcı açıklamasını dikkate almaz).
 */
export function autoDescribe(step) {
  const n = normalizeStep(step);
  const { action, meta } = n;
  const label = clip(meta.label, 50) || labelFromTarget(n.target);
  const kind = KINDS[meta.elementKind] || KINDS[kindFallback(action, meta)];
  const subj = label ? `'${label}' ` : '';
  // Etiket yoksa türü yalın haliyle anarız ("butona", "alana"…)
  const noLabel = {
    dat: { butonuna: 'butona', 'bağlantısına': 'bağlantıya', 'alanına': 'alana', 'listesine': 'listeye',
           'dosya alanına': 'dosya alanına', 'onay kutusuna': 'onay kutusuna', 'seçeneğine': 'seçeneğe', 'öğesine': 'öğeye' },
  };
  const dat = label ? kind.dat : (noLabel.dat[kind.dat] || kind.dat);

  switch (action) {
    case 'goto':
      return `'${clip(n.value, 60)}' adresine git`;
    case 'wait': {
      const secs = parseFloat(n.value) || 1;
      return `${String(secs).replace('.', ',')} saniye bekle`;
    }
    case 'click':
      if (meta.elementKind === 'checkbox' || meta.inputType === 'checkbox') return `${subj}onay kutusunu işaretle / kaldır`;
      return `${subj}${dat} tıkla`;
    case 'fill': {
      const v = valuePhrase(n);
      return `${subj}${dat} ${v.text} yaz`;
    }
    case 'select': {
      const opt = n.bindingKey
        ? `test verisindeki '${n.bindingKey}' değerini`
        : `'${clip(meta.optionText || n.value, 40)}' seçeneğini`;
      return label ? `'${label}' ${kind.abl} ${opt} seç` : `Listeden ${opt} seç`;
    }
    case 'upload': {
      const file = n.bindingKey ? `test verisindeki '${n.bindingKey}' dosyasını` : (meta.fileName ? `'${clip(meta.fileName, 40)}' dosyasını` : 'dosyayı');
      return `${subj}${dat} ${file} yükle`;
    }
    case 'press': {
      const key = (n.value || 'Enter').trim() || 'Enter';
      return label ? `'${label}' ${kind.loc} ${key} tuşuna bas` : `${key} tuşuna bas`;
    }
    case 'assert-text': {
      const expected = n.bindingKey ? `test verisindeki '${n.bindingKey}'` : `'${clip(n.value, 50)}'`;
      // Etiket metnin kendisiyse tekrar etme
      if (!label || clip(meta.label, 50) === clip(n.value, 50)) return `Sayfada ${expected} metninin göründüğünü doğrula`;
      return `'${label}' ${kind.gen} ${expected} metnini içerdiğini doğrula`;
    }
    case 'assert-visible':
      return label ? `'${label}' ${kind.gen} göründüğünü doğrula` : 'Öğenin göründüğünü doğrula';
    default:
      return `${action}${label ? ` — '${label}'` : ''}`;
  }
}

/** Gösterilecek açıklama: kullanıcı yazdıysa o, yoksa otomatik. */
export function describeStep(step) {
  const meta = parse(step.meta, {}) || {};
  const custom = typeof meta.description === 'string' ? meta.description.trim() : '';
  const text = custom || autoDescribe(step);
  return text.charAt(0).toLocaleUpperCase('tr-TR') + text.slice(1);
}

/** Teknik ayrıntı satırı (locator) — açıklamanın altında küçük gösterilir. */
export function technicalDetail(step) {
  const n = normalizeStep(step);
  if (!n.target) return '';
  return `${n.target.strategy}=${clip(n.target.value, 60)}`;
}
