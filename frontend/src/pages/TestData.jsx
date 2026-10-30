import { useEffect, useState } from 'react';
import { api, getUser } from '../lib/api';

export default function TestData() {
  const [sets, setSets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState('');
  const [entries, setEntries] = useState([]);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState('');
  const user = getUser();

  const load = async () => setSets(await api('/test-data-sets'));
  useEffect(() => {
    load().catch((e) => setError(e.message));
    api('/projects').then(setProjects).catch(() => {});
  }, []);

  const copySet = async (setId, targetProjectId) => {
    setError('');
    try {
      await api(`/test-data-sets/${setId}/copy`, {
        method: 'POST',
        body: JSON.stringify({ targetProjectId }),
      });
      alert('Veri seti kopyalandı.');
    } catch (e) { setError(e.message); }
  };

  const open = (set) => {
    setSelected(set);
    setName(set.name);
    try { setEntries(JSON.parse(set.entries)); } catch { setEntries([]); }
  };

  // Aynı proje içinde çoğaltma: kopya kaydedilmemiş yeni bir set olarak açılır;
  // kullanıcı yalnız farklı olan değerleri (örn. başka bir kullanıcının adı/şifresi)
  // değiştirip kaydeder. Vazgeçilirse hiçbir şey oluşmaz.
  const uniqueCopyName = (base) => {
    const names = new Set(sets.map((x) => x.name));
    let candidate = `${base} (kopya)`;
    for (let n = 2; names.has(candidate); n++) candidate = `${base} (kopya ${n})`;
    return candidate;
  };

  const duplicate = (srcName, srcEntries) => {
    setSelected({ id: null, duplicatedFrom: srcName });
    setName(uniqueCopyName(srcName));
    setEntries(srcEntries.map((e) => ({ ...e })));
  };

  const duplicateSaved = (set) => {
    let list = [];
    try { list = JSON.parse(set.entries); } catch {}
    duplicate(set.name, list);
  };

  // Editördeki set çoğaltılırken kaydedilmemiş değişiklikler kopyaya taşınır,
  // orijinale yazılmaz — kullanıcıya bunu söyle.
  const duplicateFromEditor = () => {
    const saved = sets.find((x) => x.id === selected.id);
    let savedEntries = '[]';
    try { savedEntries = JSON.stringify(JSON.parse(saved?.entries || '[]')); } catch {}
    const dirty = !saved || saved.name !== name || savedEntries !== JSON.stringify(entries);
    if (dirty && !confirm('Kaydedilmemiş değişiklikleriniz kopyaya aktarılacak; orijinal veri seti değişmeyecek. Devam edilsin mi?')) return;
    duplicate(saved?.name || name, entries);
  };

  const openNew = () => {
    setSelected({ id: null });
    setName('');
    setEntries([{ key: '', type: 'text', value: '', sensitive: false }]);
  };

  const updateEntry = (i, patch) =>
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  const save = async () => {
    try {
      const body = JSON.stringify({ name, entries: JSON.stringify(entries.filter((e) => e.key)) });
      if (selected.id) await api(`/test-data-sets/${selected.id}`, { method: 'PATCH', body });
      else await api('/test-data-sets', { method: 'POST', body });
      setSelected(null);
      await load();
    } catch (e) { setError(e.message); }
  };

  const del = async (id) => {
    if (!confirm('Silinsin mi?')) return;
    await api(`/test-data-sets/${id}`, { method: 'DELETE' });
    setSelected(null);
    await load();
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Test Verileri</h1>
        <button onClick={openNew}>+ Yeni Veri Seti</button>
      </div>

      {!selected ? (
        <table>
          <thead><tr><th>Ad</th><th>Anahtar sayısı</th><th>Güncelleme</th><th></th></tr></thead>
          <tbody>
            {sets.map((s) => {
              let count = 0;
              try { count = JSON.parse(s.entries).length; } catch {}
              return (
                <tr key={s.id} onClick={() => open(s)} style={{ cursor: 'pointer' }}>
                  <td style={{ color: 'var(--accent)' }}>{s.name}</td>
                  <td>{count}</td>
                  <td className="muted">{new Date(s.updatedAt).toLocaleString('tr-TR')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="ghost" style={{ fontSize: 12, padding: '2px 10px' }}
                            title="Aynı anahtarlarla yeni bir veri seti oluştur"
                            onClick={(ev) => { ev.stopPropagation(); duplicateSaved(s); }}>
                      ⧉ Çoğalt
                    </button>
                  </td>
                </tr>
              );
            })}
            {sets.length === 0 && (
              <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                Henüz veri seti yok.
              </td></tr>
            )}
          </tbody>
        </table>
      ) : (
        <div className="card">
          {selected.duplicatedFrom && (
            <div className="muted" style={{ fontSize: 13, marginBottom: 10, padding: '8px 12px',
                                            borderRadius: 6, background: 'var(--accent-soft)' }}>
              ⧉ <b>{selected.duplicatedFrom}</b> veri setinin kopyası — henüz kaydedilmedi.
              Farklı olan değerleri değiştirip <b>Kaydet</b>'e basın. Anahtar adları aynı kaldığı sürece
              bu veri setini aynı senaryolarla kullanabilirsiniz.
            </div>
          )}
          <input placeholder="Veri seti adı" value={name}
                 onChange={(e) => setName(e.target.value)} style={{ marginBottom: 14, width: 300 }} />
          {entries.map((e, i) => (
            <div key={i} className="row" style={{ marginBottom: 8 }}>
              <input placeholder="anahtar (örn. kullanici_email)" value={e.key}
                     onChange={(ev) => updateEntry(i, { key: ev.target.value })} style={{ width: 190 }} />
              <select value={e.type || 'text'}
                      onChange={(ev) => updateEntry(i, { type: ev.target.value, value: '', fileName: undefined })}
                      style={{ width: 90 }}>
                <option value="text">metin</option>
                <option value="file">dosya</option>
              </select>
              {(e.type || 'text') === 'file' ? (
                <div className="row" style={{ flex: 1 }}>
                  <label className="ghost" style={{
                    border: '1px solid var(--border)', borderRadius: 9, padding: '7px 12px',
                    cursor: 'pointer', fontSize: 13,
                  }}>
                    Dosya Seç
                    <input type="file" style={{ display: 'none' }}
                           onChange={(ev) => {
                             const f = ev.target.files[0];
                             if (!f) return;
                             if (f.size > 3 * 1024 * 1024) {
                               setError('Dosya en fazla 3MB olabilir (demo veritabanı sınırı).');
                               return;
                             }
                             const reader = new FileReader();
                             reader.onload = () => updateEntry(i, { value: reader.result, fileName: f.name });
                             reader.readAsDataURL(f);
                           }} />
                  </label>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {e.fileName ? `📄 ${e.fileName}` : 'dosya seçilmedi'}
                  </span>
                </div>
              ) : (
                <input placeholder="değer" value={e.value}
                       type={e.sensitive ? 'password' : 'text'}
                       onChange={(ev) => updateEntry(i, { value: ev.target.value })} style={{ flex: 1 }} />
              )}
              <label className="row muted" style={{ fontSize: 12, gap: 4 }}>
                <input type="checkbox" checked={e.sensitive}
                       onChange={(ev) => updateEntry(i, { sensitive: ev.target.checked })}
                       style={{ width: 'auto' }} />
                gizli
              </label>
              <button className="danger" onClick={() => setEntries((p) => p.filter((_, idx) => idx !== i))}>✕</button>
            </div>
          ))}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="ghost"
                    onClick={() => setEntries((p) => [...p, { key: '', type: 'text', value: '', sensitive: false }])}>
              + Anahtar Ekle
            </button>
            <div style={{ flex: 1 }} />
            {selected.id && (
              <button className="ghost" onClick={duplicateFromEditor}
                      title="Bu projede aynı anahtarlarla yeni bir veri seti oluştur">
                ⧉ Çoğalt
              </button>
            )}
            {selected.id && (
              <select value="" onChange={(e) => e.target.value && copySet(selected.id, e.target.value)}
                      style={{ width: 210 }}>
                <option value="">Başka projeye kopyala →</option>
                {projects.filter((p) => p.id !== user?.workspaceId).map((p) => (
                  <option key={p.id} value={p.id}>{p.personal ? '👤 ' : '📁 '}{p.name}</option>
                ))}
              </select>
            )}
            {selected.id && <button className="danger" onClick={() => del(selected.id)}>Sil</button>}
            <button className="ghost" onClick={() => setSelected(null)}>Vazgeç</button>
            <button onClick={save} disabled={!name}>Kaydet</button>
          </div>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
