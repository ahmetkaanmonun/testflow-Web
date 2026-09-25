import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, getUser } from '../lib/api';
import { describeStep, autoDescribe } from '../lib/describe';
import { prepareRun, saveRun, postStartRun, resolveTimeout } from '../lib/run';

const ACTIONS = ['goto', 'click', 'fill', 'select', 'upload', 'press', 'assert-text', 'assert-visible', 'wait'];

export default function ScenarioDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [scenario, setScenario] = useState(null);
  const [name, setName] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [folderId, setFolderId] = useState('');
  const [manualUrl, setManualUrl] = useState(false);
  const [projects, setProjects] = useState([]);
  const [copied, setCopied] = useState(false);
  const [folders, setFolders] = useState([]);
  const [dataSets, setDataSets] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [showRun, setShowRun] = useState(false);
  const [runEnv, setRunEnv] = useState('');
  const [runDataSets, setRunDataSets] = useState(new Set()); // çoklu veri seti (data-driven)
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null); // { current, total, results: [{setName, status}] }
  const runDoneResolver = useRef(null);
  const [editingDesc, setEditingDesc] = useState(null); // açıklaması düzenlenen adım index'i
  const [timeoutSec, setTimeoutSec] = useState(''); // senaryo geneli bekleme (sn), boş = üst seviye
  const [waitStats, setWaitStats] = useState({}); // stepId -> { avgWaitMs, maxWaitMs, samples }

  useEffect(() => {
    Promise.all([api(`/scenarios/${id}`), api('/test-data-sets'), api('/environments'), api('/folders')])
      .then(([s, ds, envs, f]) => {
        setScenario(s);
        setName(s.name);
        setStartUrl(s.startUrl);
        setFolderId(s.folderId || '');
        setTimeoutSec(s.timeoutMs ? String(s.timeoutMs / 1000) : '');
        setSteps(s.steps || []);
        setDataSets(ds);
        setEnvironments(envs);
        setFolders(f);
      })
      .catch((e) => setError(e.message));
    api('/projects').then(setProjects).catch(() => {});
    api(`/runs/step-stats?scenarioId=${id}`)
      .then((list) => setWaitStats(Object.fromEntries(list.map((x) => [x.stepId, x]))))
      .catch(() => {});
  }, [id]);

  // Koşum sonucu dinleyicisi: bekleyen promise'i çözer (sıralı koşum döngüsü bekliyor)
  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== window || event.data?.type !== 'TESTFLOW_RUN_DONE') return;
      if (runDoneResolver.current) {
        runDoneResolver.current(event.data);
        runDoneResolver.current = null;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Healing kalıcılaştırma: verilen adımlar üzerinde uygular, güncel adımları döner
  const persistHealing = async (currentSteps, results) => {
    const healedResults = results.filter((r) => r.healed && r.healedStrategy);
    if (healedResults.length === 0) return currentSteps;
    const patchedSteps = currentSteps.map((s) => {
      // Kimlik varsa yalnız kimlikle eşle; sıra no. sadece id'siz (eski) sonuçlar için yedek
      const hr = healedResults.find(
        (r) => (r.stepId ? r.stepId === s.id : r.orderIndex === s.orderIndex),
      );
      if (!hr) return s;
      try {
        const cands = JSON.parse(s.candidates || '[]');
        const maxScore = Math.max(...cands.map((c) => c.score ?? 0), 0);
        const updated = cands.map((c) =>
          c.strategy === hr.healedStrategy ? { ...c, score: maxScore + 0.05 } : c,
        );
        return { ...s, candidates: JSON.stringify(updated) };
      } catch { return s; }
    });
    const updated = await api(`/scenarios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ steps: patchedSteps }),
    });
    setSteps(updated.steps || []);
    return updated.steps || patchedSteps;
  };

  // Anahtarlar tipleriyle: upload adımları dosya anahtarlarına, diğerleri metin anahtarlarına bağlanır
  const allEntries = dataSets.flatMap((ds) => {
    try { return JSON.parse(ds.entries).map((e) => ({ key: e.key, type: e.type || 'text' })); } catch { return []; }
  });
  const keysFor = (action) => [...new Set(allEntries
    .filter((e) => (action === 'upload' ? e.type === 'file' : e.type !== 'file'))
    .map((e) => e.key))];

  // Senaryo geneli süre (ms) — boş/geçersizse null (ortam/proje varsayılanına düşülür)
  const scenarioTimeoutMs = () => {
    const v = parseFloat(String(timeoutSec).replace(',', '.'));
    return v > 0 ? Math.round(Math.min(Math.max(v, 0.5), 60) * 1000) : null;
  };

  const updateStep = (i, patch) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  // meta JSON'ındaki tek alanı güncelle (boş değer alanı siler)
  const updateMeta = (i, key, value) =>
    setSteps((prev) => prev.map((s, idx) => {
      if (idx !== i) return s;
      let m = {};
      try { m = JSON.parse(s.meta || '{}'); } catch {}
      if (value === '' || value == null || value === false) delete m[key];
      else m[key] = value;
      return { ...s, meta: JSON.stringify(m) };
    }));

  const addStep = () =>
    setSteps((prev) => [...prev, {
      orderIndex: prev.length, action: 'click', candidates: '[]',
      value: '', dataBinding: null, sensitive: false, meta: '{}',
    }]);

  const removeStep = (i) =>
    setSteps((prev) => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, orderIndex: idx })));

  const moveStep = (i, dir) =>
    setSteps((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((s, idx) => ({ ...s, orderIndex: idx }));
    });

  const save = async () => {
    setError('');
    try {
      const normalized = steps.map((s, i) => ({ ...s, orderIndex: i }));
      const updated = await api(`/scenarios/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name || scenario.name,
          startUrl: startUrl || scenario.startUrl,
          folderId: folderId || null,
          steps: normalized,
          timeoutMs: scenarioTimeoutMs() ?? 0, // 0 → temizle
        }),
      });
      setScenario(updated);
      setName(updated.name);
      setStartUrl(updated.startUrl);
      setSteps(updated.steps || []);
      setTimeoutSec(updated.timeoutMs ? String(updated.timeoutMs / 1000) : '');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) { setError(e.message); }
  };

  const del = async () => {
    setError('');
    if (!window.confirm('Senaryo silinsin mi? Bu işlem geri alınamaz.')) return;
    try {
      await api(`/scenarios/${id}`, { method: 'DELETE' });
      navigate('/scenarios');
    } catch (e) { setError(e.message); }
  };

  // ---------- Koşum (data-driven: seçilen her veri setiyle sırayla) ----------
  const startRun = async () => {
    setError('');
    const hasBindingNow = steps.some((s) => s.dataBinding);
    const setList = runDataSets.size > 0 ? [...runDataSets] : [null];
    if (hasBindingNow && setList.includes(null)) {
      setError('Bu senaryoda test verisine bağlı adımlar var — en az bir veri seti seçin.');
      return;
    }

    setShowRun(false);
    setRunning(true);
    setProgress({ current: 0, total: setList.length, results: [] });

    let currentSteps = steps;
    const environment = environments.find((en) => en.id === runEnv) || null;
    const project = projects.find((p) => p.active) || null;

    for (let i = 0; i < setList.length; i++) {
      const dataSetId = setList[i];
      const setName = dataSetId
        ? (dataSets.find((d) => d.id === dataSetId)?.name ?? dataSetId)
        : 'Veri setsiz';
      setProgress((p) => ({ ...p, current: i + 1 }));

      let status;
      try {
        const dataSet = dataSetId ? dataSets.find((d) => d.id === dataSetId) : null;
        const prepared = await prepareRun({
          scenario: { ...scenario, startUrl: startUrl || scenario.startUrl, steps: currentSteps, timeoutMs: scenarioTimeoutMs() },
          environment, dataSet, project,
        });
        const done = new Promise((resolve) => { runDoneResolver.current = resolve; });
        postStartRun(prepared, { scenarioId: id, environmentId: runEnv || null, testDataSetId: dataSetId });

        const data = await done;
        const results = data.results || [];
        status = await saveRun({ scenarioId: id, environmentId: runEnv || null, testDataSetId: dataSetId, data });
        // Healing kalıcılaştır — sonraki set güncel locator'larla koşsun
        currentSteps = await persistHealing(currentSteps, results);
      } catch (e) {
        status = `hata (${e.message})`;
      }
      setProgress((p) => ({ ...p, results: [...p.results, { setName, status }] }));
    }

    setRunning(false);
    navigate('/runs');
  };

  if (!scenario) return <div className="muted">Yükleniyor…</div>;

  const hasBinding = steps.some((s) => s.dataBinding);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <input value={name} onChange={(e) => setName(e.target.value)}
               style={{
                 fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600,
                 border: '1px solid transparent', background: 'transparent',
                 padding: '4px 8px', marginLeft: -8, width: 'auto', flex: 1, maxWidth: 480,
               }}
               onFocus={(e) => { e.target.style.borderColor = 'var(--border)'; e.target.style.background = 'var(--surface)'; }}
               onBlur={(e) => { e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent'; }} />
        <div className="row">
          <select value="" onChange={async (e) => {
                    const pid = e.target.value;
                    if (!pid) return;
                    setError('');
                    try {
                      await api(`/scenarios/${id}/copy`, {
                        method: 'POST',
                        body: JSON.stringify({ targetProjectId: pid }),
                      });
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2500);
                    } catch (err) { setError(err.message); }
                  }}
                  style={{ width: 170 }}>
            <option value="">{copied ? 'Kopyalandı ✓' : 'Kopyala →'}</option>
            {projects.filter((p) => !p.active).map((p) => (
              <option key={p.id} value={p.id}>{p.personal ? '👤 ' : '📁 '}{p.name}</option>
            ))}
          </select>
          <button className="ghost" onClick={async () => {
            setError('');
            try {
              const copy = await api(`/scenarios/${id}/copy`, {
                method: 'POST',
                body: JSON.stringify({ targetProjectId: getUser().workspaceId }),
              });
              navigate(`/scenarios/${copy.id}`);
            } catch (err) { setError(err.message); }
          }}>Çoğalt</button>
          <button className="danger" onClick={del}>Sil</button>
          <button className="ghost" onClick={() => setShowRun(!showRun)} disabled={running || steps.length === 0}>
            {running ? '▶ Koşuyor…' : '▶ Koş'}
          </button>
          <button onClick={save}>{saved ? 'Kaydedildi ✓' : 'Kaydet'}</button>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 20 }}>
        <select
          value={manualUrl ? '' : (environments.find((en) => {
            try { return new URL(startUrl).origin === new URL(en.baseUrl).origin; } catch { return false; }
          })?.id || '')}
          onChange={(e) => {
            const en = environments.find((x) => x.id === e.target.value);
            if (!en) { setManualUrl(true); return; } // Elle gir: URL korunur, input açılır
            setManualUrl(false);
            // Ortam seçilince origin değişir, mevcut path korunur (varsa)
            try {
              const u = new URL(startUrl);
              setStartUrl(new URL(en.baseUrl).origin + u.pathname + u.search + u.hash);
            } catch { setStartUrl(en.baseUrl); }
          }}
          style={{ width: 180 }}>
          <option value="">Elle URL gir…</option>
          {environments.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
        </select>
        {!manualUrl && environments.some((en) => {
          try { return new URL(startUrl).origin === new URL(en.baseUrl).origin; } catch { return false; }
        }) ? (
          <span className="muted" style={{ fontSize: 13 }}>{startUrl}</span>
        ) : (
          <input value={startUrl} onChange={(e) => setStartUrl(e.target.value)}
                 placeholder="Başlangıç URL" style={{ maxWidth: 420, fontSize: 13 }} />
        )}
        <select value={folderId} onChange={(e) => setFolderId(e.target.value)} style={{ width: 180 }}>
          <option value="">Klasörsüz</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <label className="row muted" style={{ fontSize: 13, gap: 6 }}
               title="Bu senaryodaki adımların elementi bekleme süresi. Boş bırakılırsa ortam, o da yoksa proje ayarı kullanılır. Adım bazında ayrıca değiştirilebilir.">
          Bekleme
          <input value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)}
                 placeholder={`${resolveTimeout({ project: projects.find((p) => p.active) }).ms / 1000}`}
                 inputMode="decimal" style={{ width: 60 }} />
          sn
        </label>
      </div>

      {showRun && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <select value={runEnv} onChange={(e) => setRunEnv(e.target.value)} style={{ width: 260 }}>
              <option value="">Ortam: kayıttaki URL</option>
              {environments.map((en) => <option key={en.id} value={en.id}>{en.name} ({en.baseUrl})</option>)}
            </select>
            <button onClick={startRun}>
              {runDataSets.size > 1 ? `${runDataSets.size} veri setiyle koş` : 'Başlat'}
            </button>
          </div>

          {(() => {
            const t = resolveTimeout({
              scenario: { timeoutMs: scenarioTimeoutMs() },
              environment: environments.find((en) => en.id === runEnv),
              project: projects.find((p) => p.active),
            });
            return (
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                ⏱ Element bekleme süresi: <b>{t.ms / 1000} sn</b> ({t.source}); doğrulama adımlarında 2,4 katı.
                Adımda ayrıca süre verildiyse o geçerlidir.
              </div>
            );
          })()}
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Test verisi — birden fazla seçerseniz senaryo her setle ayrı ayrı koşar (data-driven):
          </div>
          <div style={{ marginBottom: 10 }}>
            {dataSets.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Tanımlı veri seti yok.</span>}
            {dataSets.map((d) => (
              <label key={d.id} className="row" style={{ gap: 6, marginBottom: 4, fontSize: 13 }}>
                <input type="checkbox" checked={runDataSets.has(d.id)}
                       onChange={() => setRunDataSets((prev) => {
                         const next = new Set(prev);
                         next.has(d.id) ? next.delete(d.id) : next.add(d.id);
                         return next;
                       })}
                       style={{ width: 'auto' }} />
                {d.name}
              </label>
            ))}
          </div>

          <div className="muted" style={{ fontSize: 12 }}>
            💡 Temiz oturum için: koşumlar gizli pencerede yapılır — bir kez
            <code>chrome://extensions</code> → TestFlow Recorder → Ayrıntılar → <b>Gizli modda izin ver</b>'i açın.
          </div>
          {hasBinding && runDataSets.size === 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              ⚠️ Bu senaryoda test verisine bağlı adımlar var — en az bir veri seti seçin.
            </div>
          )}
        </div>
      )}

      {progress && (
        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <div style={{ marginBottom: progress.results.length ? 8 : 0 }}>
            {running
              ? <>▶ Koşum {progress.current}/{progress.total} — açılan pencerede adımlar oynatılıyor…</>
              : <>Tamamlandı — {progress.results.filter((r) => r.status === 'passed').length}/{progress.total} passed</>}
          </div>
          {progress.results.map((r, i) => (
            <div key={i} className="row" style={{ fontSize: 13, marginBottom: 4 }}>
              <span className={`badge ${r.status === 'passed' ? 'passed' : 'failed'}`}>{r.status}</span>
              <span>{r.setName}</span>
            </div>
          ))}
        </div>
      )}

      {steps.map((step, i) => {
        const binding = step.dataBinding ? JSON.parse(step.dataBinding) : null;
        let firstCandidate = null;
        try {
          const cands = JSON.parse(step.candidates || '[]');
          if (cands.length) firstCandidate = `${cands[0].strategy}=${String(cands[0].value).slice(0, 40)}`;
        } catch {}
        return (
          <div key={step.id || `new-${i}`} className="card" style={{ marginBottom: 10, padding: 14 }}>
            <div className="row" style={{ marginBottom: 10, alignItems: 'flex-start' }}>
              <span className="muted" style={{ width: 24, paddingTop: 2 }}>{i + 1}</span>
              {editingDesc === i ? (
                <input autoFocus
                       defaultValue={(() => { try { return JSON.parse(step.meta || '{}').description || ''; } catch { return ''; } })()}
                       placeholder={autoDescribe(step)}
                       onBlur={(e) => { updateMeta(i, 'description', e.target.value.trim()); setEditingDesc(null); }}
                       onKeyDown={(e) => {
                         if (e.key === 'Enter') e.target.blur();
                         if (e.key === 'Escape') setEditingDesc(null);
                       }}
                       style={{ flex: 1 }} />
              ) : (
                <div style={{ flex: 1, fontWeight: 500, cursor: 'text' }}
                     title="Açıklamayı düzenlemek için tıklayın (boş bırakırsanız otomatik açıklama kullanılır)"
                     onClick={() => setEditingDesc(i)}>
                  {describeStep(step)} <span className="muted" style={{ fontSize: 12 }}>✎</span>
                </div>
              )}
            </div>
            <div className="row">
              <span style={{ width: 24 }} />
              <select value={step.action} onChange={(e) => updateStep(i, { action: e.target.value })} style={{ width: 150 }}>
                {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>

              <select
                value={binding ? `bind:${binding.dataSetKey}` : 'static'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'static') updateStep(i, { dataBinding: null });
                  else updateStep(i, { dataBinding: JSON.stringify({ dataSetKey: v.slice(5) }) });
                }}
                style={{ width: 190 }}>
                <option value="static">{step.action === 'upload' ? 'Dosya seçilmedi' : 'Sabit değer'}</option>
                {keysFor(step.action).map((k) => <option key={k} value={`bind:${k}`}>📎 {k}</option>)}
              </select>

              {binding ? (
                <span className="badge queued" style={{ flex: 1 }}>
                  Test verisinden: {binding.dataSetKey}
                </span>
              ) : (
                <input placeholder="Değer" value={step.value ?? ''}
                       onChange={(e) => updateStep(i, { value: e.target.value })}
                       type={step.sensitive ? 'password' : 'text'} style={{ flex: 1 }} />
              )}

              <label className="row muted" style={{ fontSize: 12, gap: 4 }}>
                <input type="checkbox" checked={step.sensitive}
                       onChange={(e) => updateStep(i, { sensitive: e.target.checked })}
                       style={{ width: 'auto' }} />
                gizli
              </label>

              {['fill', 'select'].includes(step.action) && (
                <label className="row muted" style={{ fontSize: 12, gap: 4 }}
                       title="Alan dolu veya kilitli (disabled) geldiyse dokunulmaz, adım atlanır; boş ve aktifse doldurulur. Dosyadan dosyaya dolu gelebilen alanlar için.">
                  <input type="checkbox"
                         checked={(() => { try { return !!JSON.parse(step.meta || '{}').ifEmpty; } catch { return false; } })()}
                         onChange={(e) => {
                           let m = {};
                           try { m = JSON.parse(step.meta || '{}'); } catch {}
                           m.ifEmpty = e.target.checked;
                           updateStep(i, { meta: JSON.stringify(m) });
                         }}
                         style={{ width: 'auto' }} />
                  boşsa
                </label>
              )}

              <label className="row muted" style={{ fontSize: 12, gap: 4 }}
                     title="Opsiyonel adım başarısız olursa koşum kesilmez, adım atlanır (bazı kayıtlarda alan dolu/kilitli gelir veya görünmez)">
                <input type="checkbox"
                       checked={(() => { try { return !!JSON.parse(step.meta || '{}').optional; } catch { return false; } })()}
                       onChange={(e) => {
                         let m = {};
                         try { m = JSON.parse(step.meta || '{}'); } catch {}
                         m.optional = e.target.checked;
                         updateStep(i, { meta: JSON.stringify(m) });
                       }}
                       style={{ width: 'auto' }} />
                ops.
              </label>

              <button className="ghost" onClick={() => moveStep(i, -1)}>↑</button>
              <button className="ghost" onClick={() => moveStep(i, 1)}>↓</button>
              <button className="danger" onClick={() => removeStep(i)}>✕</button>
            </div>
            {(() => {
              let meta = {};
              try { meta = JSON.parse(step.meta || '{}'); } catch {}
              const needsElement = !['wait', 'goto'].includes(step.action);
              const stat = step.id ? waitStats[step.id] : null;
              const effectiveMs = meta.timeoutMs || (resolveTimeout({
                scenario: { timeoutMs: scenarioTimeoutMs() }, project: projects.find((p) => p.active),
              }).ms * (step.action.startsWith('assert') ? 2.4 : 1));
              const risky = stat && stat.maxWaitMs > effectiveMs * 0.8;
              return (
                <div className="row muted" style={{ fontSize: 12, marginTop: 8, marginLeft: 34, gap: 10, flexWrap: 'wrap' }}>
                  {needsElement && (
                    <>
                      <label className="row" style={{ gap: 4 }}
                             title="Bu adım için elementi bekleme süresi. Boşsa senaryo/ortam/proje ayarı kullanılır.">
                        ⏱
                        <input value={meta.timeoutMs ? String(meta.timeoutMs / 1000) : ''}
                               onChange={(e) => {
                                 const v = parseFloat(e.target.value.replace(',', '.'));
                                 updateMeta(i, 'timeoutMs', v > 0 ? Math.round(Math.min(Math.max(v, 0.5), 60) * 1000) : null);
                               }}
                               placeholder="vars." inputMode="decimal" style={{ width: 52, fontSize: 12, padding: '2px 6px' }} />
                        sn
                      </label>
                      <select value={meta.waitFor || ''} onChange={(e) => updateMeta(i, 'waitFor', e.target.value)}
                              title="Element hangi durumda hazır sayılsın?"
                              style={{ width: 'auto', fontSize: 12, padding: '2px 6px' }}>
                        <option value="">görünür olsun (vars.)</option>
                        <option value="enabled">tıklanabilir olsun</option>
                        <option value="exists">sayfada olsun (gizli olabilir)</option>
                      </select>
                    </>
                  )}
                  {stat && (
                    <span style={{ color: risky ? 'var(--yellow)' : undefined }}
                          title={`Son 30 günde ${stat.samples} koşum`}>
                      {risky ? '⚠ ' : ''}son koşumlarda bulunma: ort. {(stat.avgWaitMs / 1000).toFixed(1).replace('.', ',')} sn,
                      en çok {(stat.maxWaitMs / 1000).toFixed(1).replace('.', ',')} sn
                    </span>
                  )}
                  {firstCandidate && <span style={{ fontSize: 11 }}>locator: {firstCandidate}</span>}
                </div>
              );
            })()}
          </div>
        );
      })}

      <button className="ghost" onClick={addStep}>+ Adım Ekle</button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
