import { useRef, useState } from 'react';
import { api } from '../lib/api';

// Dışa/içe aktarma: sunucuya taşıma, yedekleme, sistemler arası aktarım.
export default function Transfer() {
  const [scope, setScope] = useState('all');
  const [includeRuns, setIncludeRuns] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [fileText, setFileText] = useState(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const fileInput = useRef(null);

  const doExport = async () => {
    setError('');
    setExporting(true);
    try {
      const data = await api(`/transfer/export?scope=${scope}&includeRuns=${includeRuns}`);
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `testflow-aktarim-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const pickFile = (f) => {
    setError('');
    setResult(null);
    setPreview(null);
    setFileText(null);
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.format !== 'testflow-export') {
          setError('Bu dosya bir TestFlow dışa aktarma dosyası değil.');
          return;
        }
        setPreview({
          exportedAt: data.exportedAt,
          exportedBy: data.exportedBy,
          includesRuns: !!data.includesRuns,
          workspaces: (data.workspaces || []).map((w) => ({
            name: w.name,
            personal: !!w.personal,
            ownerUsername: w.ownerUsername,
            members: (w.members || []).length,
            scenarios: (w.scenarios || []).length,
            steps: (w.scenarios || []).reduce((n, s) => n + (s.steps || []).length, 0),
            dataSets: (w.testDataSets || []).length,
            environments: (w.environments || []).length,
            folders: (w.folders || []).length,
            runs: (w.runs || []).length,
          })),
        });
        setFileText(reader.result);
      } catch {
        setError('Dosya okunamadı: geçerli bir JSON dosyası değil.');
      }
    };
    reader.readAsText(f);
  };

  const doImport = async () => {
    if (!fileText) return;
    if (!confirm('Dosyadaki projeler içe aktarılacak. Mevcut verileriniz silinmez veya değiştirilmez; '
      + 'içerik yeni kayıtlar olarak eklenir. Devam edilsin mi?')) return;
    setError('');
    setImporting(true);
    try {
      const res = await api('/transfer/import', { method: 'POST', body: fileText });
      setResult(res);
      setFileText(null);
      setPreview(null);
    } catch (e) {
      setError(`İçe aktarma başarısız; hiçbir şey kaydedilmedi. (${e.message})`);
    } finally {
      setImporting(false);
    }
  };

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('tr-TR') : '—');

  return (
    <div>
      <h1 className="page-title">Aktarım</h1>
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Projelerinizi bir dosyaya aktarın ve başka bir TestFlow sunucusuna (ya da aynı sunucuya) geri yükleyin.
        Taşıma ve yedekleme için kullanılır.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>⬇ Dışa aktar</h3>
        <div className="row" style={{ gap: 18, marginBottom: 10, flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 6 }}>
            <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} style={{ width: 'auto' }} />
            Üyesi olduğum tüm projeler
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input type="radio" checked={scope === 'current'} onChange={() => setScope('current')} style={{ width: 'auto' }} />
            Yalnızca açık olan proje
          </label>
        </div>
        <label className="row" style={{ gap: 6, marginBottom: 6 }}>
          <input type="checkbox" checked={includeRuns} onChange={(e) => setIncludeRuns(e.target.checked)}
                 style={{ width: 'auto' }} />
          Koşum geçmişini de dahil et
        </label>
        {includeRuns && (
          <div className="muted" style={{ fontSize: 12, marginBottom: 10, marginLeft: 22 }}>
            Koşum geçmişi ekran görüntülerini içerdiği için dosya çok büyük olabilir (yüzlerce MB).
            Taşımada genellikle gerekmez; yeni sistemde temiz bir geçmişle başlamak önerilir.
          </div>
        )}
        <div style={{ fontSize: 13, color: 'var(--yellow)', margin: '10px 0 14px' }}>
          ⚠ Dosya, test veri setlerindeki şifreler dahil tüm değerleri içerir. Güvenli bir yerde saklayın,
          paylaşmayın ve işiniz bitince silin.
        </div>
        <button onClick={doExport} disabled={exporting}>
          {exporting ? 'Hazırlanıyor…' : '⬇ Dışa aktar'}
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>⬆ İçe aktar</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Mevcut verileriniz silinmez veya değiştirilmez; dosyadaki içerik yeni kayıtlar olarak eklenir.
          Kişisel alan içeriği sizin kişisel alanınıza, ortak projeler üyeleriyle birlikte yeni proje olarak aktarılır.
          Bir hata olursa hiçbir şey kaydedilmez.
        </p>
        <div className="row" style={{ marginBottom: 12 }}>
          <input ref={fileInput} type="file" accept=".json,application/json" style={{ display: 'none' }}
                 onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          <button className="ghost" onClick={() => fileInput.current?.click()} disabled={importing}>
            📄 Dosya seç
          </button>
          {fileName && <span className="muted" style={{ fontSize: 13 }}>{fileName}</span>}
        </div>

        {preview && (
          <div style={{ marginTop: 6 }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              {fmt(preview.exportedAt)} tarihinde <b>{preview.exportedBy || '—'}</b> tarafından dışa aktarıldı
              {preview.includesRuns ? ' · koşum geçmişi dahil' : ''}
            </div>
            <table>
              <thead>
                <tr>
                  <th>Proje</th><th>Senaryo</th><th>Adım</th><th>Veri seti</th>
                  <th>Ortam</th><th>Klasör</th><th>Üye</th>{preview.includesRuns && <th>Koşum</th>}
                </tr>
              </thead>
              <tbody>
                {preview.workspaces.map((w, i) => (
                  <tr key={i}>
                    <td>{w.personal ? `👤 Kişisel alan (${w.ownerUsername})` : `📁 ${w.name}`}</td>
                    <td>{w.scenarios}</td><td>{w.steps}</td><td>{w.dataSets}</td>
                    <td>{w.environments}</td><td>{w.folders}</td><td>{w.members}</td>
                    {preview.includesRuns && <td>{w.runs}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 14 }}>
              <button onClick={doImport} disabled={importing}>
                {importing ? 'İçe aktarılıyor…' : '⬆ İçe aktar'}
              </button>
              <button className="ghost" onClick={() => { setPreview(null); setFileText(null); setFileName(''); }}>
                Vazgeç
              </button>
            </div>
          </div>
        )}

        {result && (
          <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 8, background: 'var(--accent-soft)' }}>
            <b>✓ İçe aktarma tamamlandı.</b>{' '}
            {result.workspaces} proje, {result.scenarios} senaryo ({result.steps} adım), {result.testDataSets} veri seti,{' '}
            {result.environments} ortam, {result.folders} klasör{result.runs ? `, ${result.runs} koşum` : ''} aktarıldı.
            {result.notes?.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                {result.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Yeni projelerin üst menüdeki proje listesinde görünmesi için sayfayı yenileyin.
            </div>
          </div>
        )}
      </div>

      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}
    </div>
  );
}
