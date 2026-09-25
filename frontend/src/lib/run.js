// Koşum hazırlığı ve sonuç kaydı — senaryo detayı, toplu koşum ve tekrar koşum
// aynı mantığı kullanır (önceden üç sayfada ayrı ayrı kopyalanmıştı).
import { api } from './api';

export const DEFAULT_TIMEOUT_MS = 5000;

/** Ortam seçiliyse URL'in yalnızca origin'i değişir, path korunur. */
export function applyEnvironment(url, environment) {
  if (!environment) return url;
  try {
    const u = new URL(url);
    return new URL(environment.baseUrl).origin + u.pathname + u.search + u.hash;
  } catch {
    return environment.baseUrl;
  }
}

/** Veri setine bağlı adımların değerini çözer; eksik anahtar koşum başlamadan hata verir. */
export function resolveBindings(steps, dataSet) {
  let entries = [];
  if (dataSet) {
    try { entries = JSON.parse(dataSet.entries); } catch { entries = []; }
  }
  const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
  return steps.map((s) => {
    if (!s.dataBinding) return s;
    const key = JSON.parse(s.dataBinding).dataSetKey;
    const entry = byKey[key];
    if (entry === undefined) {
      throw new Error(dataSet
        ? `"${key}" anahtarı "${dataSet.name}" veri setinde yok.`
        : `"${key}" test verisine bağlı — bir veri seti seçin.`);
    }
    return { ...s, value: entry.value, ...(entry.type === 'file' ? { fileName: entry.fileName } : {}) };
  });
}

/**
 * Bekleme süresi önceliği: senaryo → ortam → proje → sistem (5 sn).
 * Adım seviyesi (meta.timeoutMs) eklentide uygulanır.
 * @returns {{ ms: number, source: string }}
 */
export function resolveTimeout({ scenario, environment, project }) {
  if (scenario?.timeoutMs) return { ms: scenario.timeoutMs, source: 'senaryo' };
  if (environment?.defaultTimeoutMs) return { ms: environment.defaultTimeoutMs, source: `ortam (${environment.name})` };
  if (project?.defaultTimeoutMs) return { ms: project.defaultTimeoutMs, source: 'proje' };
  return { ms: DEFAULT_TIMEOUT_MS, source: 'sistem varsayılanı' };
}

/** Aktif proje (ayarları için). Hata olursa null — koşum varsayılanla sürer. */
export async function fetchActiveProject() {
  try {
    const projects = await api('/projects');
    return projects.find((p) => p.active) || null;
  } catch {
    return null;
  }
}

function withMeta(step, extra) {
  let meta = {};
  try { meta = JSON.parse(step.meta || '{}'); } catch {}
  return { ...step, meta: JSON.stringify({ ...meta, ...extra }) };
}

/** Önkoşul zinciri (koşum sırasıyla, her senaryo bir kez). */
export async function fetchPreconditionChain(ids) {
  if (!ids || ids.length === 0) return [];
  return api(`/scenarios/precondition-chain?ids=${encodeURIComponent(ids.join(','))}`);
}

/**
 * Eklentiye gönderilecek koşum paketini hazırlar.
 * scenario: { id, startUrl, steps, timeoutMs, preconditionIds } — editördeki
 * kaydedilmemiş hali de olabilir.
 *
 * Önkoşul varsa adım listesi: [önkoşul 1 adımları] → (önkoşul 2'nin adresine git →
 * önkoşul 2 adımları) … → senaryonun başlangıç adresine git → senaryo adımları.
 * Önkoşul adımları meta.precondition ile işaretlenir; biri başarısız olursa koşum
 * 'blocked' sayılır. Ekleme için kullanıldığında (araya kayıt) scenario.steps
 * yalnız ön adımları içerir; zincir yine başa eklenir.
 */
export async function prepareRun({ scenario, environment = null, dataSet = null, project = null }) {
  const chain = await fetchPreconditionChain(scenario.preconditionIds);
  const combined = [];
  chain.forEach((pre, k) => {
    const tag = { precondition: { scenarioId: pre.id, scenarioName: pre.name } };
    if (k > 0) {
      combined.push(withMeta({ action: 'goto', candidates: '[]', value: applyEnvironment(pre.startUrl, environment),
        dataBinding: null, sensitive: false, meta: '{}' }, { ...tag, synthetic: true }));
    }
    for (const st of pre.steps || []) combined.push(withMeta(st, tag));
  });
  if (chain.length > 0) {
    combined.push(withMeta({ action: 'goto', candidates: '[]', value: applyEnvironment(scenario.startUrl, environment),
      dataBinding: null, sensitive: false, meta: '{}' },
      { synthetic: true, description: 'Önkoşullar tamam — senaryonun başlangıç adresine git' }));
  }
  combined.push(...(scenario.steps || []));

  const firstUrl = chain.length > 0 ? chain[0].startUrl : scenario.startUrl;
  return {
    startUrl: applyEnvironment(firstUrl, environment),
    steps: resolveBindings(combined, dataSet),
    runConfig: { defaultTimeoutMs: resolveTimeout({ scenario, environment, project }).ms },
    preconditionCount: combined.length - (scenario.steps || []).length,
  };
}

/** Sonuç bir önkoşul adımına mı ait? */
export function isPreconditionResult(result) {
  try { return !!JSON.parse(result.stepSnapshot || '{}')?.meta?.precondition; } catch { return false; }
}

/** Eklentiden dönen sonucun durumu. */
export function runStatus(data) {
  const results = data.results || [];
  const failed = results.find((r) => r.status === 'failed');
  // Önkoşul sağlanamadıysa senaryonun kendisi test edilemedi: failed değil blocked
  if (failed && isPreconditionResult(failed)) return 'blocked';
  if (data.aborted || failed) return 'failed';
  return 'passed';
}

/** Koşum sonucunu backend'e kaydeder, durumu döner. */
export async function saveRun({ scenarioId, environmentId = null, testDataSetId = null, data }) {
  const status = runStatus(data);
  await api('/runs', {
    method: 'POST',
    body: JSON.stringify({
      scenarioId,
      environmentId,
      testDataSetId,
      status,
      startedAt: data.startedAt,
      finishedAt: data.finishedAt,
      stepResults: data.results || [],
    }),
  });
  return status;
}

/**
 * Araya kayıt: 1..afterIndex+1 adımları oynatılır, sonra aynı sekmede kayıt başlar.
 * prepared.steps yalnızca oynatılacak ön adımları içermeli.
 */
export function postStartRecordFrom({ startUrl, steps, runConfig }, insertContext) {
  window.postMessage({ type: 'TESTFLOW_START_RECORD_FROM', startUrl, steps, runConfig, insertContext }, '*');
}

/** Eklentiye koşum başlat mesajı. */
export function postStartRun({ startUrl, steps, runConfig }, runContext) {
  window.postMessage({ type: 'TESTFLOW_START_RUN', startUrl, steps, runConfig, runContext }, '*');
}
