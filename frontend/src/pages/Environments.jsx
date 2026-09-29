import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function Environments() {
  const [envs, setEnvs] = useState([]);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [timeoutSec, setTimeoutSec] = useState('');

  // "8" / "2,5" → ms; boş → 0 (temizle)
  const toMs = (v) => {
    const n = parseFloat(String(v).replace(',', '.'));
    return n > 0 ? Math.round(n * 1000) : 0;
  };
  const [error, setError] = useState('');

  const load = async () => setEnvs(await api('/environments'));
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  const create = async () => {
    try {
      await api('/environments', { method: 'POST', body: JSON.stringify({ name, baseUrl, defaultTimeoutMs: toMs(timeoutSec) }) });
      setName(''); setBaseUrl(''); setTimeoutSec('');
      await load();
    } catch (e) { setError(e.message); }
  };

  const updateTimeout = async (env, value) => {
    const ms = toMs(value);
    if ((env.defaultTimeoutMs || 0) === ms) return;
    setError('');
    try {
      await api(`/environments/${env.id}`, { method: 'PATCH', body: JSON.stringify({ defaultTimeoutMs: ms }) });
      await load();
    } catch (e) { setError(e.message); await load(); }
  };

  const del = async (id) => {
    await api(`/environments/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div>
      <h1 className="page-title">Ortamlar</h1>
      <div className="row" style={{ marginBottom: 16 }}>
        <input placeholder="Ad (örn. Staging)" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} />
        <input placeholder="Base URL (https://staging.sirket.com)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={{ width: 340 }} />
        <input placeholder="Bekleme (sn)" value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)}
               title="Bu ortamda koşarken elementi bekleme süresi. Boşsa proje ayarı kullanılır."
               inputMode="decimal" style={{ width: 120 }} />
        <button onClick={create} disabled={!name || !baseUrl}>Ekle</button>
      </div>
      <table>
        <thead><tr><th>Ad</th><th>Base URL</th><th title="Boşsa proje ayarı kullanılır">Bekleme süresi</th><th></th></tr></thead>
        <tbody>
          {envs.map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td>
              <td className="muted">{e.baseUrl}</td>
              <td>
                <input key={`${e.id}-${e.defaultTimeoutMs ?? ''}`}
                       defaultValue={e.defaultTimeoutMs ? String(e.defaultTimeoutMs / 1000) : ''}
                       placeholder="proje ayarı" inputMode="decimal" style={{ width: 90 }}
                       onBlur={(ev) => updateTimeout(e, ev.target.value)}
                       onKeyDown={(ev) => ev.key === 'Enter' && ev.target.blur()} /> <span className="muted">sn</span>
              </td>
              <td style={{ textAlign: 'right' }}>
                <button className="danger" onClick={() => del(e.id)}>Sil</button>
              </td>
            </tr>
          ))}
          {envs.length === 0 && (
            <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 30 }}>Henüz ortam yok.</td></tr>
          )}
        </tbody>
      </table>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
