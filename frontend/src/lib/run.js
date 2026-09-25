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

/**
 * Eklentiye gönderilecek koşum paketini hazırlar.
 * scenario: { id, startUrl, steps, timeoutMs } — editördeki kaydedilmemiş hali de olabilir.
 */
export async function prepareRun({ scenario, environment = null, dataSet = null, project = null }) {
  const steps = resolveBindings(scenario.steps || [], dataSet);
  return {
    startUrl: applyEnvironment(scenario.startUrl, environment),
    steps,
    runConfig: { defaultTimeoutMs: resolveTimeout({ scenario, environment, project }).ms },
  };
}

/** Eklentiden dönen sonucun durumu. */
export function runStatus(data) {
  const results = data.results || [];
  if (data.aborted || results.some((r) => r.status === 'failed')) return 'failed';
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
export function postStartRecordFrom(prepared, insertContext) {
  window.postMessage({ type: 'TESTFLOW_START_RECORD_FROM', ...prepared, insertContext }, '*');
}

/** Eklentiye koşum başlat mesajı. */
export function postStartRun(prepared, runContext) {
  window.postMessage({ type: 'TESTFLOW_START_RUN', ...prepared, runContext }, '*');
}
