// Web uygulamasının çalışmak için ihtiyaç duyduğu en düşük eklenti sürümü.
// Eklentide web uygulamasını etkileyen bir değişiklik yapıldığında artırılır;
// kullanıcıda daha eski sürüm varsa uyarı bandı güncellemesini ister.
export const MIN_EXTENSION_VERSION = '0.14.0';

/** '0.13.1' < '0.14.0' → -1, eşitse 0, büyükse 1 */
export function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Eklentinin durumunu sorar. Sonuç: { installed, version, incognitoAllowed }
 * Yanıt gelmezse (eklenti yok / bu adres eklentide tanımlı değil) installed=false.
 */
export function probeExtension(timeoutMs = 1500) {
  return new Promise((resolve) => {
    let done = false;
    const onMessage = (event) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'TESTFLOW_PONG') return;
      done = true;
      window.removeEventListener('message', onMessage);
      resolve({ installed: true, version: event.data.version, incognitoAllowed: event.data.incognitoAllowed });
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'TESTFLOW_PING' }, window.location.origin);
    setTimeout(() => {
      if (done) return;
      window.removeEventListener('message', onMessage);
      resolve({ installed: false, version: null, incognitoAllowed: null });
    }, timeoutMs);
  });
}
