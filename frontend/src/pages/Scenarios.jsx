import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { prepareRun, saveRun, postStartRun, fetchActiveProject } from '../lib/run';

export default function Scenarios() {
  const [scenarios, setScenarios] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [error, setError] = useState('');
  const [extension, setExtension] = useState(null); // null=bilinmiyor, false=yok, string=versiyon
  const [recording, setRecording] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [environments, setEnvironments] = useState([]);
  const [dataSets, setDataSets] = useState([]);
  const [batchEnv, setBatchEnv] = useState('');
  const [batchDataSet, setBatchDataSet] = useState('');
  const [showBatch, setShowBatch] = useState(false);
  const [batch, setBatch] = useState(null); // { current, total, results: [{name, status}] }
  const navigate = useNavigate();
  const recordMeta = useRef({});
  const runDoneResolver = useRef(null);

  const load = async () => {
    const [s, f, e, d] = await Promise.all([
      api('/scenarios'), api('/folders'), api('/environments'), api('/test-data-sets'),
    ]);
    setScenarios(s);
    setFolders(f);
    setEnvironments(e);
    setDataSets(d);
  };

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  // Eklenti tespiti + kayıt sonucu dinleyicisi
  useEffect(() => {
    const onMessage = async (event) => {
      if (event.source !== window || !event.data) return;

      if (event.data.type === 'TESTFLOW_PONG') {
        setExtension(event.data.version);
      }

      if (event.data.type === 'TESTFLOW_RUN_DONE' && runDoneResolver.current) {
        runDoneResolver.current(event.data);
        runDoneResolver.current = null;
      }

      if (event.data.type === 'TESTFLOW_RECORDING_DONE') {
        setRecording(false);
        const steps = (event.data.steps || []).map((s, i) => ({ ...s, orderIndex: i, dataBinding: null }));
        try {
          const created = await api('/scenarios', {
            method: 'POST',
            body: JSON.stringify({
              name: event.data.scenarioName,
              startUrl: event.data.startUrl,
              folderId: recordMeta.current.folderId || null,
              steps,
            }),
          });
          navigate(`/scenarios/${created.id}`);
        } catch (e) {
          setError(`Kayıt alındı ama senaryo kaydedilemedi: ${e.message}`);
        }
      }
    };
    window.addEventListener('message', onMessage);

    // Eklenti var mı? (bridge.js cevap verir)
    window.postMessage({ type: 'TESTFLOW_PING' }, '*');
    const timeout = setTimeout(() => setExtension((v) => (v === null ? false : v)), 1500);

    return () => { window.removeEventListener('message', onMessage); clearTimeout(timeout); };
  }, [navigate]);

  const startRecording = () => {
    if (!name || !startUrl) return;
    recordMeta.current = { folderId: selectedFolder || null };
    setRecording(true);
    window.postMessage({ type: 'TESTFLOW_START_RECORDING', scenarioName: name, startUrl }, '*');
  };

  const createEmpty = async () => {
    try {
      const created = await api('/scenarios', {
        method: 'POST',
        body: JSON.stringify({ name, startUrl, folderId: selectedFolder || null, steps: [] }),
      });
      setName(''); setStartUrl(''); setShowNew(false);
      navigate(`/scenarios/${created.id}`);
    } catch (e) { setError(e.message); }
  };

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Tek senaryoyu koş, RUN_DONE bekle, sonucu kaydet — durum döner
  const runOne = async (scenarioId, project) => {
    const scenario = await api(`/scenarios/${scenarioId}`);
    if (!scenario.steps?.length) throw new Error('adım yok');
    const environment = environments.find((en) => en.id === batchEnv) || null;
    const dataSet = batchDataSet ? dataSets.find((d) => d.id === batchDataSet) : null;
    const prepared = await prepareRun({ scenario, environment, dataSet, project });

    const done = new Promise((resolve) => { runDoneResolver.current = resolve; });
    postStartRun(prepared, { scenarioId, environmentId: batchEnv || null, testDataSetId: batchDataSet || null });
    const data = await done;
    return saveRun({ scenarioId, environmentId: batchEnv || null, testDataSetId: batchDataSet || null, data });
  };

  const startBatch = async () => {
    const ids = [...selected];
    setShowBatch(false);
    setBatch({ current: 0, total: ids.length, results: [] });
    const project = await fetchActiveProject();
    for (let i = 0; i < ids.length; i++) {
      const name = scenarios.find((s) => s.id === ids[i])?.name ?? ids[i];
      setBatch((b) => ({ ...b, current: i + 1 }));
      let status;
      try {
        status = await runOne(ids[i], project);
      } catch (e) {
        status = `atlandı (${e.message})`;
      }
      setBatch((b) => ({ ...b, results: [...b.results, { name, status }] }));
    }
    setSelected(new Set());
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await api('/folders', { method: 'POST', body: JSON.stringify({ name: newFolderName }) });
      setNewFolderName('');
      await load();
    } catch (e) { setError(e.message); }
  };

  const visible = selectedFolder
    ? scenarios.filter((s) => s.folderId === selectedFolder)
    : scenarios;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Senaryolar</h1>
        <div className="row">
          {typeof extension === 'string' && (
            <span className="muted" style={{ fontSize: 12 }}>Eklenti v{extension}</span>
          )}
          <button onClick={() => setShowNew(!showNew)}>+ Yeni Senaryo</button>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <select value={selectedFolder} onChange={(e) => setSelectedFolder(e.target.value)} style={{ width: 220 }}>
          <option value="">Tüm klasörler</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <input placeholder="Yeni klasör adı" value={newFolderName}
               onChange={(e) => setNewFolderName(e.target.value)} style={{ width: 200 }} />
        <button className="ghost" onClick={createFolder}>Klasör Ekle</button>
      </div>

      {selected.size > 0 && !batch && (
        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          {!showBatch ? (
            <div className="row">
              <span><b>{selected.size}</b> senaryo seçildi</span>
              <button onClick={() => setShowBatch(true)} disabled={!extension}>▶ Toplu Koş</button>
              <button className="ghost" onClick={() => setSelected(new Set())}>Seçimi Temizle</button>
              {!extension && <span className="muted" style={{ fontSize: 12 }}>Koşum için eklenti gerekli.</span>}
            </div>
          ) : (
            <div className="row">
              <select value={batchEnv} onChange={(e) => setBatchEnv(e.target.value)} style={{ width: 220 }}>
                <option value="">Ortam: kayıttaki URL</option>
                {environments.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
              </select>
              <select value={batchDataSet} onChange={(e) => setBatchDataSet(e.target.value)} style={{ width: 220 }}>
                <option value="">Test verisi: yok</option>
                {dataSets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button onClick={startBatch}>{selected.size} Senaryoyu Koş</button>
              <button className="ghost" onClick={() => setShowBatch(false)}>Vazgeç</button>
            </div>
          )}
        </div>
      )}

      {batch && (
        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: batch.results.length ? 10 : 0 }}>
            <span>
              {batch.results.length < batch.total
                ? <>▶ Toplu koşum: <b>{batch.current}/{batch.total}</b></>
                : <>Toplu koşum tamamlandı — {batch.results.filter((r) => r.status === 'passed').length} passed,{' '}
                    {batch.results.filter((r) => r.status !== 'passed').length} diğer</>}
            </span>
            {batch.results.length >= batch.total && (
              <div className="row">
                <button className="ghost" onClick={() => navigate('/runs')}>Koşumlara Git</button>
                <button className="ghost" onClick={() => setBatch(null)}>Kapat</button>
              </div>
            )}
          </div>
          {batch.results.map((r, i) => (
            <div key={i} className="row" style={{ fontSize: 13, marginBottom: 4 }}>
              <span className={`badge ${r.status === 'passed' ? 'passed' : 'failed'}`}>{r.status}</span>
              <span>{r.name}</span>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <input placeholder="Senaryo adı" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 240 }} />
            <select
              value={environments.find((en) => startUrl.startsWith(en.baseUrl))?.id || ''}
              onChange={(e) => {
                const en = environments.find((x) => x.id === e.target.value);
                setStartUrl(en ? en.baseUrl : '');
              }}
              style={{ width: 190 }}>
              <option value="">Elle URL gir…</option>
              {environments.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
            </select>
            {environments.find((en) => startUrl.startsWith(en.baseUrl)) ? (
              <span className="muted" style={{ fontSize: 13, flex: 1 }}>{startUrl}</span>
            ) : (
              <input placeholder="Başlangıç URL (https://...)" value={startUrl} onChange={(e) => setStartUrl(e.target.value)} />
            )}
          </div>
          {environments.length === 0 && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              İpucu: Ortamlar sayfasında ortam tanımlarsanız URL'yi buradan seçebilirsiniz.
            </div>
          )}

          {recording ? (
            <div className="badge queued" style={{ padding: '8px 14px' }}>
              🔴 Kayıt sürüyor — açılan sekmede işlemlerinizi yapın, bitince "Kaydı Bitir"e basın.
            </div>
          ) : (
            <div className="row">
              <button onClick={startRecording} disabled={!name || !startUrl || !extension}>
                🔴 Kaydı Başlat
              </button>
              <button className="ghost" onClick={createEmpty} disabled={!name || !startUrl}>
                Boş Oluştur (adımları elle gir)
              </button>
              {extension === false && (
                <span className="muted" style={{ fontSize: 12 }}>
                  Kayıt için TestFlow Recorder eklentisi gerekli —
                  Chrome/Edge'de <code>chrome://extensions</code> → Geliştirici modu →
                  "Paketlenmemiş öğe yükle" → repodaki <code>extension/</code> klasörünü seçin, sonra bu sayfayı yenileyin.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th style={{ width: 36 }}>
              <input type="checkbox"
                     checked={visible.length > 0 && visible.every((s) => selected.has(s.id))}
                     onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((s) => s.id)) : new Set())} />
            </th>
            <th>Ad</th><th>Başlangıç URL</th><th>Adım</th><th>Güncelleme</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((s) => (
            <tr key={s.id}>
              <td>
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} />
              </td>
              <td><Link to={`/scenarios/${s.id}`} style={{ color: 'var(--accent)' }}>{s.name}</Link></td>
              <td className="muted">{s.startUrl}</td>
              <td>{s.stepCount}</td>
              <td className="muted">{new Date(s.updatedAt).toLocaleString('tr-TR')}</td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 30 }}>
              Henüz senaryo yok.
            </td></tr>
          )}
        </tbody>
      </table>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
