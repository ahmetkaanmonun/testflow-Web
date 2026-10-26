import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import { prepareRun, saveRun, postStartRun, fetchActiveProject } from '../lib/run';
import { describeStep, technicalDetail } from '../lib/describe';
import { formatDateTime, formatTimeMs, formatOffset, formatDuration, diffMs } from '../lib/format';
import { useBatchRun } from '../lib/useBatchRun';
import BatchProgress from '../components/BatchProgress';

export default function Runs() {
  const [runs, setRuns] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [detail, setDetail] = useState(null);
  const [detailSteps, setDetailSteps] = useState({}); // stepId -> adım tanımı
  const [preview, setPreview] = useState(null); // büyütülen ekran görüntüsü
  const [error, setError] = useState('');

  // Yeni (toplu) koşum paneli
  const { batch, setBatch, runBatch, running: batchRunning, extension } = useBatchRun();
  const [showNewRun, setShowNewRun] = useState(false);
  const [folders, setFolders] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [dataSets, setDataSets] = useState([]);
  const [pick, setPick] = useState(new Set());
  const [pickSearch, setPickSearch] = useState('');
  const [pickFolder, setPickFolder] = useState('');
  const [runEnv, setRunEnv] = useState('');
  const [runDataSet, setRunDataSet] = useState('');

  const openDetail = async (run) => {
    setDetailSteps({});
    try {
      // Liste artık özet döner; adım sonuçları + görüntüler detay endpoint'inden
      const full = await api(`/runs/${run.id}`);
      setDetail(full);
    } catch (err) { setError(err.message); return; }
    try {
      const s = await api(`/scenarios/${run.scenarioId}`);
      const map = {};
      for (const st of s.steps || []) map[st.id] = st;
      setDetailSteps(map);
    } catch { /* senaryo silinmiş olabilir — adım tanımları görünmez, sorun değil */ }
  };

  // Adımı doğal dille anlat. Öncelik koşum anındaki snapshot'ta (o an ne
  // koşulduysa o); eski kayıtlarda snapshot yoksa senaryonun güncel adımına düşülür.
  const stepLabel = (result) => {
    let src = null;
    if (result.stepSnapshot) {
      try { src = JSON.parse(result.stepSnapshot); } catch {}
    }
    if (!src && result.stepId) src = detailSteps[result.stepId] || null;
    if (!src) return null;
    let pre = null;
    try { pre = (typeof src.meta === 'string' ? JSON.parse(src.meta) : src.meta)?.precondition || null; } catch {}
    return { text: describeStep(src), detail: technicalDetail(src), precondition: pre,
             iteration: src.iteration ? `${src.iteration}/${src.iterations}` : null };
  };

  const load = () =>
    Promise.all([api('/runs'), api('/scenarios')])
      .then(([r, s]) => { setRuns(r); setScenarios(s); })
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);
  useEffect(() => {
    Promise.all([api('/folders'), api('/environments'), api('/test-data-sets')])
      .then(([f, e, d]) => { setFolders(f); setEnvironments(e); setDataSets(d); })
      .catch(() => {});
  }, []);

  // Toplu koşum bitince listeyi yenile
  const batchDone = batch && batch.results.length >= batch.total;
  useEffect(() => { if (batchDone) load(); }, [batchDone]);

  // Her senaryonun en son koşum durumu (liste en yeni koşum önce gelir)
  const lastStatus = {};
  for (const r of [...runs].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))) {
    if (!(r.scenarioId in lastStatus)) lastStatus[r.scenarioId] = r.status;
  }
  const folderName = (id) => folders.find((f) => f.id === id)?.name;
  const pickVisible = scenarios.filter((sc) =>
    (!pickFolder || sc.folderId === pickFolder) &&
    (!pickSearch || sc.name.toLocaleLowerCase('tr-TR').includes(pickSearch.toLocaleLowerCase('tr-TR'))));
  const togglePick = (id) => setPick((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const startNewRun = async () => {
    setError('');
    // Seçim sırası yerine listedeki sırayla koş (öngörülebilir olsun)
    const items = scenarios.filter((sc) => pick.has(sc.id)).map((sc) => ({ id: sc.id, name: sc.name }));
    setShowNewRun(false);
    await runBatch(items, {
      environment: environments.find((en) => en.id === runEnv) || null,
      dataSet: runDataSet ? dataSets.find((d) => d.id === runDataSet) : null,
    });
    setPick(new Set());
  };

  const scenarioName = (id) => scenarios.find((s) => s.id === id)?.name ?? id;

  const [rerunning, setRerunning] = useState(null); // koşulan run id
  const rerunCtx = useRef(null);

  // Eklentiden koşum sonucu geldiğinde kaydet
  useEffect(() => {
    const onMessage = async (event) => {
      if (event.source !== window || event.data?.type !== 'TESTFLOW_RUN_DONE') return;
      if (!rerunCtx.current) return; // bu sayfadan başlatılan bir koşum değil
      const ctx = rerunCtx.current;
      rerunCtx.current = null;
      setRerunning(null);

      try {
        await saveRun({
          scenarioId: ctx.scenarioId,
          environmentId: ctx.environmentId,
          testDataSetId: ctx.testDataSetId,
          data: event.data,
        });
        await load();
      } catch (err) { setError(err.message); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Koşumu aynı ortam + test verisiyle yeniden başlat
  const rerun = async (e, run) => {
    e.stopPropagation();
    setError('');
    try {
      const scenario = await api(`/scenarios/${run.scenarioId}`);
      if (!scenario.steps?.length) throw new Error('Senaryoda adım yok.');

      const dataSet = run.testDataSetId ? await api(`/test-data-sets/${run.testDataSetId}`) : null;
      const environment = run.environmentId
        ? (await api('/environments')).find((en) => en.id === run.environmentId) || null
        : null;
      const project = await fetchActiveProject();
      let prepared;
      try {
        prepared = await prepareRun({ scenario, environment, dataSet, project });
      } catch (err) {
        throw new Error(`${err.message} Veri seti silinmiş/değişmiş olabilir — senaryo sayfasından koşun.`);
      }

      rerunCtx.current = {
        scenarioId: run.scenarioId,
        environmentId: run.environmentId || null,
        testDataSetId: run.testDataSetId || null,
      };
      setRerunning(run.id);
      postStartRun(prepared, rerunCtx.current);
    } catch (err) { setError(err.message); }
  };

  const deleteRun = async (e, id) => {
    e.stopPropagation(); // satır tıklamasını (detay açma) tetikleme
    if (!window.confirm('Bu koşum kaydı silinsin mi?')) return;
    try {
      await api(`/runs/${id}`, { method: 'DELETE' });
      if (detail?.id === id) setDetail(null);
      await load();
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Koşum Geçmişi</h1>
        <button onClick={() => setShowNewRun(!showNewRun)} disabled={batchRunning || !!rerunning}>
          ▶ Yeni Koşum
        </button>
      </div>

      {showNewRun && !batchRunning && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
            <input placeholder="Senaryo ara…" value={pickSearch} onChange={(e) => setPickSearch(e.target.value)}
                   style={{ width: 220 }} />
            <select value={pickFolder} onChange={(e) => setPickFolder(e.target.value)} style={{ width: 200 }}>
              <option value="">Tüm klasörler</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <button className="ghost"
                    onClick={() => setPick(new Set(pickVisible.map((sc) => sc.id)))}>
              Görünenlerin tümünü seç
            </button>
            <button className="ghost"
                    onClick={() => setPick(new Set(scenarios
                      .filter((sc) => ['failed', 'blocked'].includes(lastStatus[sc.id])).map((sc) => sc.id)))}
                    title="Son koşumu failed veya blocked olan senaryolar">
              Son koşumu başarısız olanları seç
            </button>
            {pick.size > 0 && <button className="ghost" onClick={() => setPick(new Set())}>Seçimi temizle</button>}
          </div>

          <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            {pickVisible.length === 0 && (
              <div className="muted" style={{ padding: 14, fontSize: 13 }}>Eşleşen senaryo yok.</div>
            )}
            {pickVisible.map((sc) => (
              <label key={sc.id} className="row"
                     style={{ padding: '8px 12px', gap: 10, borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                <input type="checkbox" checked={pick.has(sc.id)} onChange={() => togglePick(sc.id)} />
                <span style={{ flex: 1 }}>{sc.name}</span>
                {folderName(sc.folderId) && <span className="muted" style={{ fontSize: 12 }}>{folderName(sc.folderId)}</span>}
                <span className="muted" style={{ fontSize: 12, width: 60, textAlign: 'right' }}>{sc.stepCount} adım</span>
                {lastStatus[sc.id]
                  ? <span className={`badge ${lastStatus[sc.id]}`} title="Son koşum">{lastStatus[sc.id]}</span>
                  : <span className="muted" style={{ fontSize: 12 }}>hiç koşulmadı</span>}
              </label>
            ))}
          </div>

          <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
            <select value={runEnv} onChange={(e) => setRunEnv(e.target.value)} style={{ width: 220 }}>
              <option value="">Ortam: kayıttaki URL</option>
              {environments.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
            </select>
            <select value={runDataSet} onChange={(e) => setRunDataSet(e.target.value)} style={{ width: 220 }}>
              <option value="">Test verisi: yok</option>
              {dataSets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button onClick={startNewRun} disabled={pick.size === 0 || !extension}>
              {pick.size > 0 ? `${pick.size} senaryoyu koş` : 'Senaryo seçin'}
            </button>
            <button className="ghost" onClick={() => setShowNewRun(false)}>Vazgeç</button>
            {extension === false && (
              <span className="muted" style={{ fontSize: 12 }}>Koşum için TestFlow eklentisi gerekli.</span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Senaryolar listedeki sırayla, art arda koşulur. Önkoşulu olan senaryolarda önce önkoşullar çalışır.
          </div>
        </div>
      )}

      <BatchProgress batch={batch} onClose={() => setBatch(null)} />
      <table>
        <thead>
          <tr><th>Senaryo</th><th>Durum</th><th>Başlatan</th><th>Başlangıç</th><th>Süre</th><th></th></tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const durationSec = r.startedAt && r.finishedAt
              ? Math.round((new Date(r.finishedAt) - new Date(r.startedAt)) / 1000) : null;
            return (
              <tr key={r.id} onClick={() => openDetail(r)} style={{ cursor: 'pointer' }}>
                <td style={{ color: 'var(--accent)' }}>{scenarioName(r.scenarioId)}</td>
                <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                <td>{r.triggeredBy}</td>
                <td className="muted">{r.startedAt ? new Date(r.startedAt).toLocaleString('tr-TR') : '—'}</td>
                <td className="muted">{durationSec != null ? `${durationSec}sn` : '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {r.status !== 'passed' && (
                    <button className="ghost" onClick={(e) => rerun(e, r)}
                            disabled={rerunning !== null || batchRunning} style={{ marginRight: 6 }}>
                      {rerunning === r.id ? '▶ Koşuyor…' : '↻ Tekrar Koş'}
                    </button>
                  )}
                  <button className="danger" onClick={(e) => deleteRun(e, r.id)}>Sil</button>
                </td>
              </tr>
            );
          })}
          {runs.length === 0 && (
            <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Henüz koşum yok.</td></tr>
          )}
        </tbody>
      </table>

      {detail && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <strong>{scenarioName(detail.scenarioId)} — adım sonuçları</strong>
            <button className="ghost" onClick={() => setDetail(null)}>Kapat</button>
          </div>
          <div className="row muted" style={{ fontSize: 13, marginBottom: 12, gap: 20 }}>
            <span>Başlangıç: <b>{formatDateTime(detail.startedAt)}</b></span>
            <span>Bitiş: <b>{formatDateTime(detail.finishedAt)}</b></span>
            <span>Toplam süre: <b>{formatDuration(diffMs(detail.startedAt, detail.finishedAt))}</b></span>
          </div>
          <table>
            <thead><tr><th>#</th><th>Adım</th><th>Durum</th><th>Zaman</th><th>Süre</th><th>Healed</th><th>Hata</th><th>Görüntü</th></tr></thead>
            <tbody>
              {detail.stepResults.map((s) => {
                const label = stepLabel(s);
                return (
                <tr key={s.id} style={label?.precondition ? { background: 'var(--surface2)' } : undefined}>
                  <td>{s.orderIndex + 1}</td>
                  <td>
                    {label ? (
                      <>
                        {label.iteration && (
                          <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>
                            🔁 Satır {label.iteration}
                          </div>
                        )}
                        {label.precondition && (
                          <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>
                            Önkoşul: {label.precondition.scenarioName}
                          </div>
                        )}
                        <div>{label.text}</div>
                        {label.detail && (
                          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{label.detail}</div>
                        )}
                      </>
                    ) : <span className="muted">adım tanımı yok (eski kayıt, senaryo silinmiş olabilir)</span>}
                  </td>
                  <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {s.startedAt ? (
                      <>
                        <div title={formatDateTime(s.startedAt)}>{formatTimeMs(s.startedAt)}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{formatOffset(s.startedAt, detail.startedAt)}</div>
                      </>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {s.startedAt && s.finishedAt ? (
                      <>
                        <div>{formatDuration(diffMs(s.startedAt, s.finishedAt))}</div>
                        {s.locatedAt && (
                          <div className="muted" style={{ fontSize: 12 }}
                               title="Elementin ekranda bulunmasına kadar geçen süre">
                            bekleme {formatDuration(diffMs(s.startedAt, s.locatedAt))}
                          </div>
                        )}
                      </>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td>{s.healed ? `✓ (${s.healedStrategy ?? '-'})` : '—'}</td>
                  <td className="muted">
                    {s.errorMessage
                      ? (s.status === 'passed' && s.errorMessage.startsWith('Not: ')
                          ? <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>{s.errorMessage.slice(5)}</span>
                          : s.errorMessage)
                      : '—'}
                  </td>
                  <td>
                    {s.screenshot ? (
                      <img src={s.screenshot} alt={`adım ${s.orderIndex + 1}`}
                           style={{ width: 110, borderRadius: 6, cursor: 'zoom-in', border: '1px solid var(--border)' }}
                           onClick={() => setPreview(s.screenshot)} />
                    ) : <span className="muted">—</span>}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {preview && (
        <div onClick={() => setPreview(null)}
             style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      zIndex: 1000, cursor: 'zoom-out' }}>
          <img src={preview} alt="ekran görüntüsü"
               style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8 }} />
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
