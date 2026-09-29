import { useEffect, useState } from 'react';
import { api, getUser } from '../lib/api';

export default function Project() {
  const user = getUser();
  const [project, setProject] = useState(null);
  const [members, setMembers] = useState([]);
  const [newUsername, setNewUsername] = useState('');
  const [error, setError] = useState('');
  const [timeoutSec, setTimeoutSec] = useState('');
  const [timeoutSaved, setTimeoutSaved] = useState(false);

  const load = async () => {
    const projects = await api('/projects');
    const current = projects.find((p) => p.id === user.workspaceId);
    setProject(current);
    setTimeoutSec(current?.defaultTimeoutMs ? String(current.defaultTimeoutMs / 1000) : '');
    if (current) setMembers(await api(`/projects/${current.id}/members`));
  };

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  const addMember = async () => {
    setError('');
    try {
      await api(`/projects/${project.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ username: newUsername }),
      });
      setNewUsername('');
      await load();
    } catch (e) { setError(e.message); }
  };

  const removeMember = async (username) => {
    if (!window.confirm(`${username} projeden çıkarılsın mı?`)) return;
    setError('');
    try {
      await api(`/projects/${project.id}/members/${encodeURIComponent(username)}`, { method: 'DELETE' });
      await load();
    } catch (e) { setError(e.message); }
  };

  const saveTimeout = async () => {
    setError('');
    const n = parseFloat(String(timeoutSec).replace(',', '.'));
    try {
      await api(`/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ defaultTimeoutMs: n > 0 ? Math.round(n * 1000) : 0 }),
      });
      await load();
      setTimeoutSaved(true);
      setTimeout(() => setTimeoutSaved(false), 2000);
    } catch (e) { setError(e.message); }
  };

  const settingsCard = (
    <div className="card" style={{ marginTop: 16 }}>
      <strong>Koşum ayarları</strong>
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <span>Element bekleme süresi</span>
        <input value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && saveTimeout()}
               placeholder="5" inputMode="decimal" style={{ width: 70 }} />
        <span className="muted">sn</span>
        <button onClick={saveTimeout}>{timeoutSaved ? 'Kaydedildi ✓' : 'Kaydet'}</button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Adımlarda elementin ekranda görünmesi için beklenecek süre (0,5–60 sn). Boş bırakılırsa 5 sn.
        Öncelik: adım → senaryo → ortam → proje. Doğrulama adımları bu sürenin 2,4 katı bekler.
      </p>
    </div>
  );

  if (!project) return <div className="muted">Yükleniyor…</div>;

  const isOwner = project.ownerUsername === user.username;

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="page-title">{project.personal ? '👤 ' : '📁 '}{project.name}</h1>

      {project.personal ? (
        <div className="card">
          <p>Burası sizin <b>Kişisel Alanınız</b> — yalnızca siz görürsünüz, üye eklenemez.</p>
          <p className="muted" style={{ marginTop: 8 }}>
            Ekiple çalışmak için sol üstteki listeden <b>＋ Yeni proje</b> oluşturun ve
            arkadaşlarınızı üye ekleyin. Senaryolarınızı ve test verilerinizi
            "Kopyala" ile projeye taşıyabilirsiniz.
          </p>
        </div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            <input placeholder="AD kullanıcı adı (örn. fatma.kaya)" value={newUsername}
                   onChange={(e) => setNewUsername(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && addMember()}
                   style={{ width: 280 }} />
            <button onClick={addMember} disabled={!newUsername.trim()}>Üye Ekle</button>
          </div>

          <table>
            <thead><tr><th>Kullanıcı</th><th>Ekleyen</th><th>Tarih</th><th></th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.username}>
                  <td>{m.username} {m.owner && <span className="badge queued">sahip</span>}</td>
                  <td className="muted">{m.addedBy}</td>
                  <td className="muted">{new Date(m.createdAt).toLocaleDateString('tr-TR')}</td>
                  <td style={{ textAlign: 'right' }}>
                    {!m.owner && (isOwner || m.username === user.username) && (
                      <button className="danger" onClick={() => removeMember(m.username)}>
                        {m.username === user.username ? 'Ayrıl' : 'Çıkar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {settingsCard}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
