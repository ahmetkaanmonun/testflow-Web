// TestFlow web sayfasında çalışır. Sayfa (window.postMessage) ile
// eklenti (chrome.runtime) arasında mesaj köprüsü kurar.
// Yalnız manifest'teki TestFlow adreslerinde çalışır (content_scripts.matches);
// mesajlar yalnız bu sayfanın kendi origin'ine gönderilir (kayıt sonuçları
// değer içerebilir — '*' ile her hedefe gönderilmez).
const SELF_ORIGIN = window.location.origin;

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || !event.data.type) return;
  const { type } = event.data;

  if (type === 'TESTFLOW_PING') {
    const version = chrome.runtime.getManifest().version;
    chrome.runtime.sendMessage({ type: 'GET_EXTENSION_STATUS' })
      .then((st) => window.postMessage(
        { type: 'TESTFLOW_PONG', version, incognitoAllowed: !!(st && st.incognitoAllowed) }, SELF_ORIGIN))
      .catch(() => window.postMessage({ type: 'TESTFLOW_PONG', version, incognitoAllowed: null }, SELF_ORIGIN));
  }

  if (type === 'TESTFLOW_START_RECORDING') {
    chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      startUrl: event.data.startUrl,
      scenarioName: event.data.scenarioName,
    });
  }

  if (type === 'TESTFLOW_START_RECORD_FROM') {
    chrome.runtime.sendMessage({
      type: 'START_RECORD_FROM',
      startUrl: event.data.startUrl,
      steps: event.data.steps,             // oynatılacak ön adımlar (binding çözülmüş)
      runConfig: event.data.runConfig,
      insertContext: event.data.insertContext, // { scenarioId, afterIndex }
    });
  }

  if (type === 'TESTFLOW_START_RUN') {
    chrome.runtime.sendMessage({
      type: 'START_RUN',
      startUrl: event.data.startUrl,
      steps: event.data.steps,          // binding'leri çözülmüş adımlar
      runContext: event.data.runContext, // scenarioId, environmentId, testDataSetId
      runConfig: event.data.runConfig,   // { defaultTimeoutMs }
    });
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'RECORDING_DONE') {
    const { type: _t, ...rest } = msg;
    window.postMessage({ ...rest, type: 'TESTFLOW_RECORDING_DONE' }, SELF_ORIGIN);
  }
  if (msg.type === 'RECORD_FROM_FAILED') {
    const { type: _t, ...rest } = msg;
    window.postMessage({ ...rest, type: 'TESTFLOW_RECORD_FROM_FAILED' }, SELF_ORIGIN);
  }
  if (msg.type === 'RUN_DONE') {
    // Tüm alanlar iletilir (aborted dahil — önceden düşüyordu, elle kapatılan
    // koşum arayüzde "passed" görünebiliyordu)
    const { type: _t, ...rest } = msg;
    window.postMessage({ ...rest, type: 'TESTFLOW_RUN_DONE' }, SELF_ORIGIN);
  }
});
