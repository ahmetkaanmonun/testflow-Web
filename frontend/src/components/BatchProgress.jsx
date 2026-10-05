import { badgeClass } from '../lib/useBatchRun';

// Toplu koşum ilerleme ve sonuç kartı (Senaryolar ve Koşum Geçmişi ortak)
export default function BatchProgress({ batch, onClose, actions = null }) {
  if (!batch) return null;
  const finished = batch.results.length >= batch.total;
  const passed = batch.results.filter((r) => r.status === 'passed').length;
  return (
    <div className="card" style={{ marginBottom: 16, padding: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: batch.results.length ? 10 : 0 }}>
        <span>
          {finished
            ? <>Toplu koşum tamamlandı — {passed} passed, {batch.results.length - passed} diğer</>
            : <>▶ Toplu koşum: <b>{batch.current}/{batch.total}</b> — açılan pencerede senaryolar sırayla koşuluyor</>}
        </span>
        {finished && (
          <div className="row">
            {actions}
            <button className="ghost" onClick={onClose}>Kapat</button>
          </div>
        )}
      </div>
      {batch.results.map((r, i) => (
        <div key={i} className="row" style={{ fontSize: 13, marginBottom: 4 }}>
          <span className={`badge ${badgeClass(r.status)}`}>{r.status}</span>
          <span>{r.name}</span>
        </div>
      ))}
    </div>
  );
}
