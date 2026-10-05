// Seçilen senaryoları sırayla koşan ortak mantık — Senaryolar ve Koşum Geçmişi
// sayfaları aynı kodu kullanır. Eklenti aynı anda tek koşum yürüttüğü için
// senaryolar art arda koşulur: biri bitmeden (RUN_DONE) sonraki başlamaz.
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { prepareRun, saveRun, postStartRun, fetchActiveProject } from './run';

export function useBatchRun() {
  const resolver = useRef(null);
  const [batch, setBatch] = useState(null); // { current, total, results: [{ name, status }] }
  const [extension, setExtension] = useState(null); // null=bilinmiyor, false=yok, string=sürüm

  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type === 'TESTFLOW_PONG') setExtension(event.data.version);
      // Yalnız bu hook'un başlattığı koşumu yakala (tekrar koşum vb. kendi bayrağıyla ilerler)
      if (event.data.type === 'TESTFLOW_RUN_DONE' && resolver.current) {
        resolver.current(event.data);
        resolver.current = null;
      }
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'TESTFLOW_PING' }, '*');
    const timeout = setTimeout(() => setExtension((v) => (v === null ? false : v)), 1500);
    return () => { window.removeEventListener('message', onMessage); clearTimeout(timeout); };
  }, []);

  const runOne = async (scenarioId, { environment, dataSet, project }) => {
    const scenario = await api(`/scenarios/${scenarioId}`);
    if (!scenario.steps?.length) throw new Error('adım yok');
    const prepared = await prepareRun({ scenario, environment, dataSet, project });
    const ctx = { scenarioId, environmentId: environment?.id || null, testDataSetId: dataSet?.id || null };
    const done = new Promise((resolve) => { resolver.current = resolve; });
    postStartRun(prepared, ctx);
    const data = await done;
    return saveRun({ ...ctx, data });
  };

  /**
   * items: [{ id, name }] — sırayla koşulur.
   * Bir senaryo hazırlanamazsa (adım yok, veri seti eksik…) atlanır, diğerleri sürer.
   */
  const runBatch = async (items, { environment = null, dataSet = null } = {}) => {
    setBatch({ current: 0, total: items.length, results: [] });
    const project = await fetchActiveProject();
    for (let i = 0; i < items.length; i++) {
      setBatch((b) => ({ ...b, current: i + 1 }));
      let status;
      try {
        status = await runOne(items[i].id, { environment, dataSet, project });
      } catch (e) {
        status = `atlandı (${e.message})`;
      }
      setBatch((b) => ({ ...b, results: [...b.results, { name: items[i].name, status }] }));
    }
  };

  const running = !!batch && batch.results.length < batch.total;

  return { batch, setBatch, runBatch, running, extension };
}

/** Toplu koşum ilerleme/sonuç kartı için rozet sınıfı. */
export function badgeClass(status) {
  if (status === 'passed' || status === 'blocked') return status;
  return 'failed';
}
