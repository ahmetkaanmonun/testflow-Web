import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

function StatCard({ label, value, tone }) {
  return (
    <div className="card" style={{ flex: 1, padding: '18px 20px' }}>
      <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, marginTop: 6,
        color: tone ? `var(--${tone})` : 'var(--text)',
      }}>
        {value}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [runs, setRuns] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api('/runs'), api('/scenarios')])
      .then(([r, s]) => { setRuns(r); setScenarios(s); })
      .catch((e) => setError(e.message));
  }, []);

  const now = Date.now();
  const week = runs.filter((r) => now - new Date(r.createdAt).getTime() < 7 * 24 * 3600 * 1000);
  const passed = week.filter((r) => r.status === 'passed').length;
  const failed = week.filter((r) => r.status === 'failed').length;
  // blocked: önkoşul sağlanamadı, senaryonun kendisi test edilemedi — başarı oranına katılmaz
  const blocked = week.filter((r) => r.status === 'blocked').length;
  const passRate = passed + failed > 0 ? Math.round((passed / (passed + failed)) * 100) : null;
  const healedTotal = week.reduce((sum, r) => sum + (r.healedSteps || 0), 0);

  const scenarioName = (id) => scenarios.find((s) => s.id === id)?.name ?? '(silinmiş senaryo)';

  // En çok kırılan senaryolar (7 gün, failed koşum sayısına göre)
  const failCounts = {};
  for (const r of week) {
    if (r.status === 'failed') failCounts[r.scenarioId] = (failCounts[r.scenarioId] || 0) + 1;
  }
  const topFailing = Object.entries(failCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const recent = runs.slice(0, 5);

  return (
    <div>
      <h1 className="page-title">Genel Bakış</h1>
      <div className="muted" style={{ marginTop: -10, marginBottom: 20 }}>Son 7 gün</div>

      <div className="row" style={{ gap: 14, marginBottom: 24, alignItems: 'stretch' }}>
        <StatCard label="Koşum" value={week.length} />
        <StatCard label="Başarı Oranı" value={passRate != null ? `%${passRate}` : '—'}
                  tone={passRate == null ? null : passRate >= 80 ? 'green' : passRate >= 50 ? 'yellow' : 'red'} />
        <StatCard label="İyileşen Adım" value={healedTotal} tone={healedTotal > 0 ? 'yellow' : null} />
        {blocked > 0 && <StatCard label="Önkoşulu Sağlanamayan" value={blocked} tone="yellow" />}
        <StatCard label="Toplam Senaryo" value={scenarios.length} />
      </div>

      <div className="row" style={{ gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 15, marginBottom: 10 }}>En çok kırılan senaryolar</h2>
          {topFailing.length === 0 ? (
            <div className="card muted">Son 7 günde başarısız koşum yok 🎉</div>
          ) : (
            <table>
              <thead><tr><th>Senaryo</th><th>Başarısız koşum</th></tr></thead>
              <tbody>
                {topFailing.map(([sid, count]) => (
                  <tr key={sid}>
                    <td><Link to={`/scenarios/${sid}`}>{scenarioName(sid)}</Link></td>
                    <td><span className="badge failed">{count}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 15, marginBottom: 10 }}>Son koşumlar</h2>
          {recent.length === 0 ? (
            <div className="card muted">Henüz koşum yok — bir senaryo kaydedip koşarak başlayın.</div>
          ) : (
            <table>
              <thead><tr><th>Senaryo</th><th>Durum</th><th>Zaman</th></tr></thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td>{scenarioName(r.scenarioId)}</td>
                    <td><span className={`badge ${r.status}`}>{r.status}</span>
                        {r.healedSteps > 0 && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>⚕ {r.healedSteps}</span>}</td>
                    <td className="muted">{new Date(r.createdAt).toLocaleString('tr-TR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 10 }}>
            <Link to="/runs" className="muted" style={{ fontSize: 13 }}>Tüm koşumlar →</Link>
          </div>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
