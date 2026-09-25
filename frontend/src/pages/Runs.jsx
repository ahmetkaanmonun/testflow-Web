import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import { formatDateTime, formatTimeMs, formatOffset, formatDuration, diffMs } from '../lib/format';

export default function Runs() {
  const [runs, setRuns] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [detail, setDetail] = useState(null);
  const [detailSteps, setDetailSteps] = useState({}); // stepId -> adım tanımı
  const [preview, setPreview] = useState(null); // büyütülen ekran görüntüsü
  const [error, setError] = useState('');

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

  // Adımı insan diline çevir: aksiyon + hedef + değer.
  // Öncelik koşum anındaki snapshot'ta (o an ne koşulduysa o); eski kayıtlarda
  // snapshot yoksa senaryonun güncel adım tanımına düşülür.
  const stepLabel = (result) => {
    let snap = null;
    if (result.stepSnapshot) {
      try { snap = JSON.parse(result.stepSnapshot); } catch {}
    }
    if (!snap) {
      const st = result.stepId ? detailSteps[result.stepId] : null;
      if (!st) return null;
      let target = null;
      try {
        const cands = JSON.parse(st.candidates || '[]');
        if (cands.length) target = cands[0];
      } catch {}
      let bindingKey = null;
      try { if (st.dataBinding) bindingKey = JSON.parse(st.dataBinding).dataSetKey; } catch {}
      snap = { action: st.action, target, value: st.sensitive || bindingKey ? null : st.value,
               dataBindingKey: bindingKey, sensitive: st.sensitive };
    }
    const target = snap.target ? `${snap.target.strategy}=${String(snap.target.value).slice(0, 30)}` : '';
    let value = '';
    if (snap.dataBindingKey) value = ` → 📎 ${snap.dataBindingKey}`;
    else if (snap.sensitive) value = ' → ••••';
    else if (snap.value && ['fill', 'select', 'assert-text'].includes(snap.action)) {
      value = ` → "${String(snap.value).slice(0, 25)}"`;
    }
    return { action: snap.action, detail: `${target}${value}` };
  };

  const load = () =>
    Promise.all([api('/runs'), api('/scenarios')])
      .then(([r, s]) => { setRuns(r); setScenarios(s); })
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

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

      const results = event.data.results || [];
      const anyFailed = results.some((r) => r.status === 'failed');
      try {
        await api('/runs', {
          method: 'POST',
          body: JSON.stringify({
            scenarioId: ctx.scenarioId,
            environmentId: ctx.environmentId,
            testDataSetId: ctx.testDataSetId,
            status: event.data.aborted ? 'failed' : (anyFailed ? 'failed' : 'passed'),
            startedAt: event.data.startedAt,
            finishedAt: event.data.finishedAt,
            stepResults: results,
          }),
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

      // Test verisi çözümü
      let byKey = {};
      if (run.testDataSetId) {
        const set = await api(`/test-data-sets/${run.testDataSetId}`);
        byKey = Object.fromEntries(JSON.parse(set.entries).map((en) => [en.key, en]));
      }
      const steps = scenario.steps.map((s) => {
        if (!s.dataBinding) return s;
        const key = JSON.parse(s.dataBinding).dataSetKey;
        const entry = byKey[key];
        if (entry === undefined) {
          throw new Error(`"${key}" anahtarı koşumun test veri setinde yok — set silinmiş/değişmiş olabilir. Senaryo sayfasından koşun.`);
        }
        return { ...s, value: entry.value, ...(entry.type === 'file' ? { fileName: entry.fileName } : {}) };
      });

      // Ortam çözümü
      let startUrl = scenario.startUrl;
      if (run.environmentId) {
        const envs = await api('/environments');
        const env = envs.find((en) => en.id === run.environmentId);
        if (env) {
          try {
            const u = new URL(scenario.startUrl);
            startUrl = new URL(env.baseUrl).origin + u.pathname + u.search + u.hash;
          } catch { startUrl = env.baseUrl; }
        }
      }

      rerunCtx.current = {
        scenarioId: run.scenarioId,
        environmentId: run.environmentId || null,
        testDataSetId: run.testDataSetId || null,
      };
      setRerunning(run.id);
      window.postMessage({
        type: 'TESTFLOW_START_RUN',
        startUrl,
        steps,
        runContext: rerunCtx.current,
      }, '*');
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
      <h1 className="page-title">Koşum Geçmişi</h1>
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
                            disabled={rerunning !== null} style={{ marginRight: 6 }}>
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
                <tr key={s.id}>
                  <td>{s.orderIndex + 1}</td>
                  <td>
                    {label ? (
                      <>
                        <code>{label.action}</code>
                        <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{label.detail}</div>
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
                  <td className="muted">{s.errorMessage ?? '—'}</td>
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
