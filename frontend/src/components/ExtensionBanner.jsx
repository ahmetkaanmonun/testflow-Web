import { useEffect, useState } from 'react';
import { MIN_EXTENSION_VERSION, compareVersions, probeExtension } from '../lib/extension';

// Eklentiyle ilgili kullanıcının bilmesi gereken sorunlar için sayfa üstü uyarı.
// Sorun yoksa hiçbir şey göstermez.
export default function ExtensionBanner() {
  const [status, setStatus] = useState(null);
  const [hidden, setHidden] = useState(false);

  const check = () => probeExtension().then(setStatus);
  useEffect(() => {
    check();
    // Kullanıcı ayarı değiştirip sekmeye dönünce yeniden kontrol et
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  if (!status || hidden) return null;

  let title = null;
  let body = null;
  if (!status.installed) {
    title = 'TestFlow eklentisi bulunamadı';
    body = (
      <>Kayıt ve koşum için Chrome ya da Edge'de TestFlow eklentisinin yüklü ve etkin olması gerekir.
        Yüklü olduğu halde bu uyarıyı görüyorsanız sayfayı yenileyin; sorun sürerse eklentiniz bu sunucu
        adresini tanımayan eski bir sürüm olabilir.</>
    );
  } else if (compareVersions(status.version, MIN_EXTENSION_VERSION) < 0) {
    title = `Eklentiniz güncel değil (${status.version})`;
    body = <>Bu TestFlow sürümü en az {MIN_EXTENSION_VERSION} sürümlü eklentiyle çalışır. Eklentiyi güncelleyip sayfayı yenileyin.</>;
  } else if (status.incognitoAllowed === false) {
    title = 'Eklentinin gizli modda çalışmasına izin verilmemiş';
    body = (
      <>Bu durumda testler normal pencerede çalışır ve temiz bir başlangıç için test edilen sitenin çerezleri
        silinir: <b>aynı sitede açık olan kendi oturumunuz kapanır.</b> Düzeltmek için tarayıcınızda{' '}
        <code>chrome://extensions</code> (Edge'de <code>edge://extensions</code>) sayfasını açın →
        TestFlow Recorder → <b>Ayrıntılar</b> → <b>Gizli modda izin ver</b> (Edge'de <b>InPrivate'te izin ver</b>)
        seçeneğini açın, sonra bu sayfaya dönün.</>
    );
  }
  if (!title) return null;

  return (
    <div style={{
      marginBottom: 18, padding: '12px 14px', borderRadius: 8,
      border: '1px solid var(--yellow)', background: 'color-mix(in srgb, var(--yellow) 12%, transparent)',
      fontSize: 13, display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: 16 }}>⚠</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
        <div className="muted">{body}</div>
      </div>
      <button className="ghost" style={{ fontSize: 12, padding: '2px 8px' }} onClick={() => setHidden(true)}
              title="Bu oturumda gizle">✕</button>
    </div>
  );
}
