# TestFlow Mimari Dokümanı

Bu doküman TestFlow'un teknik mimarisini, bileşenler arası akışları ve
tasarım kararlarının gerekçelerini anlatır. Hedef kitle: projeyi devralacak,
katkı verecek veya kurulumunu yapacak geliştiriciler.

---

## 1. Genel Bakış

TestFlow üç bileşenden oluşur:

```
┌─────────────────┐   HTTP/JSON (JWT)   ┌──────────────────────┐
│  React SPA       │◄───────────────────►│  Spring Boot API      │
│  (frontend/)     │                     │  (backend/)           │
│  Vite, port 5173 │                     │  port 8080            │
└────────┬────────┘                     │  ├─ Spring Security    │
         │ window.postMessage           │  ├─ LDAP (embedded/AD) │
         ▼                              │  └─ JPA + H2           │
┌─────────────────┐                     └──────────────────────┘
│ Tarayıcı        │
│ Eklentisi (MV3) │──── hedef siteleri açar, kaydeder ve koşar
│ (extension/)    │     (gizli pencere / temiz oturum)
└─────────────────┘
```

**Sorumluluk dağılımı:**

| Bileşen | Sorumluluk |
|---|---|
| React SPA | Tüm kullanıcı arayüzü; koşum orkestrasyonu (binding çözümü, sonuç kaydetme) |
| Spring Boot | Kimlik doğrulama, veri saklama, workspace izolasyonu, REST API |
| Eklenti | Hedef sitede olay yakalama (kayıt) ve adım oynatma (koşum); tarayıcı yetkileri gerektiren her şey |

Kritik tasarım kararı: **koşum motoru sunucuda değil, kullanıcının
tarayıcısında** (eklenti) çalışır. Artısı: sunucu tarafında tarayıcı
altyapısı gerektirmez, koşum gözle izlenebilir, kurumsal ağ/VPN arkasındaki
sitelere kullanıcının kendi erişimiyle ulaşır. Eksisi: zamanlanmış/headless
koşum yoktur (bkz. §9).

## 2. Kimlik ve İzolasyon

**Giriş akışı (proje modeli):**
1. `POST /api/auth/login` (kullanıcı adı + şifre)
2. `LdapAuthService.authenticate`: kullanıcının DN'i ile LDAP **bind**
   denemesi — şifre yanlışsa exception → 401. **AD yalnızca kimlik doğrular;
   grup eşlemesi yoktur.**
3. `WorkspaceService.getOrCreatePersonal`: kullanıcının **Kişisel Alan**'ı
   getirilir; ilk girişte otomatik oluşturulup üyeliği yazılır
4. JWT üretilir; claim'ler: `sub`, `displayName`, `workspaceId` (aktif
   proje), `workspaceName`. Süre: 7 gün
5. Proje değiştirme: `POST /api/projects/{id}/switch` üyelik doğrulayıp
   **yeni JWT** döner — tüm controller'lar değişmeden çalışır çünkü
   workspaceId'yi token'dan okurlar

**Proje/üyelik modeli:** `Workspace` (name, ownerUsername, personal) +
`WorkspaceMember` (workspaceId, username, unique). Üye ekleme LDAP'ta
kullanıcı varlığını doğrular (`LdapAuthService.findUser`). Paylaşım,
`/scenarios/{id}/copy` ve `/test-data-sets/{id}/copy` ile hedef projeye
**bağımsız kopya** üretir (üyelik doğrulamalı); aynı projeye kopya
"(kopya)" ekiyle çoğaltmadır.

**İzolasyon modeli:** Her istek `JwtAuthFilter`'dan geçer; token'dan
`AuthenticatedUser` üretilip request attribute'una konur. **Her repository
sorgusu `workspaceId` ile filtrelidir** (`findByIdAndWorkspaceId` vb.) —
izolasyon veritabanı sorgusu seviyesindedir, arayüz gizlemesi değildir.

**Mock → gerçek AD:** Geliştirmede embedded UnboundID sunucusu
`mock-ldap.ldif` ile ayağa kalkar. Gerçek AD'ye geçişte
`application.properties`'teki `spring.ldap.*` ayarları değişir ve
`LdapAuthService` içindeki `TODO(gerçek-AD)` işaretli iki metod uyarlanır
(AD'de kullanıcı `sAMAccountName` ile aranır, grup üyeliği `memberOf`
attribute'undan okunur).

## 3. Veri Modeli

8 JPA entity'si (hepsi UUID kimlikli):

```
Workspace (ldapGroup unique)
 ├─ Folder        (workspaceId)
 ├─ Scenario      (workspaceId, folderId?) ──1:N── Step (orderIndex sıralı)
 ├─ TestDataSet   (workspaceId, entries: JSON)
 ├─ Environment   (workspaceId, baseUrl)
 └─ Run           (workspaceId, scenarioId) ──1:N── RunStepResult
```

**Bilinçli tercih — JSON-string alanlar:** `Step.candidates`,
`Step.dataBinding`, `Step.meta`, `TestDataSet.entries`,
`RunStepResult.screenshot` düz TEXT/CLOB kolonlarda JSON string olarak
tutulur. Gerekçe: bu veriler backend'de hiç sorgulanmaz/işlenmez — üretici
ve tüketicisi eklenti+frontend'dir; şemasız tutmak eklenti evrimini backend
migration'ına bağlamaz ve H2/PostgreSQL/MSSQL arasında taşınabilirliği korur
(PG'ye özgü jsonb bilinçli olarak kullanılmadı).

`Step.dataBinding` örneği: `{"dataSetKey":"sifre"}` — doluysa koşumda değer
test veri setinden çözülür. `Step.meta` bayrakları: `optional` (ops.),
`ifEmpty` (boşsa), `inputType` (tür doğrulaması için), `fileName`.

**TestDataSet.entries** örneği:
`[{"key":"sifre","type":"text","value":"...","sensitive":true},
  {"key":"fatura","type":"file","value":"data:application/pdf;base64,...","fileName":"f.pdf"}]`

## 4. Eklenti Mimarisi (Manifest V3)

Dört script, iki köprü:

```
React SPA ──window.postMessage──► bridge.js ──chrome.runtime──► background.js
   ▲                                (TestFlow                      (oturum sahibi,
   └────────────postMessage──────── sekmesinde)◄──runtime────────  service worker)
                                                                      ▲ │
                                                     hedef sitede:    │ ▼
                                                  recorder.js / player.js
```

- **bridge.js** — yalnızca TestFlow arayüz sayfalarına enjekte edilir; sayfa
  ile eklenti arasında mesaj çevirmenidir (`TESTFLOW_*` ↔ runtime mesajları).
  Eklenti tespiti PING/PONG ile yapılır (PONG sürüm döner; arayüz gösterir).
- **background.js** — tek gerçek durum sahibi. Oturum
  (`{mode: 'record'|'play', tabId, steps, index, results, ...}`)
  **`chrome.storage.session`'da** tutulur çünkü MV3 service worker'ı her an
  uyutulabilir; bellekte durum güvenilmezdir.
- **recorder.js / player.js** — `<all_urls>`'e enjekte edilir ama her sayfa
  yüklemesinde background'a "bu sekmede kayıt/koşum var mı?" diye sorar;
  yoksa sessizce çıkar. Bu sorgu-kapı deseni, script'lerin her sitede yüklü
  olmasının maliyetini sıfıra indirir.

**Sayfa geçişlerine dayanıklılık (koşumun kalbi):** Tıklama sayfayı
değiştirdiğinde content script ölür. Yeni sayfada player yeniden yüklenir,
`GET_PLAY_STATE` ile background'dan **kaldığı adım index'ini** alır ve
oradan sürer. Bunun çalışması için kritik kural: **click sonucu tıklamadan
ÖNCE raporlanır** — element bulunduğu anda adım fiilen başarılıdır; rapor
sonrası tıklama sayfayı öldürse bile index ilerlemiştir. (Aksi halde rapor
kaybolur, aynı adım yeni sayfada tekrar aranır ve sahte "element bulunamadı"
üretirdi.)

**Temiz oturum (A/B planı):** Kayıt ve koşum başlarken:
- **A:** `chrome.extension.isAllowedIncognitoAccess()` true ise gizli
  pencere açılır; iş bitince pencere kapatılır → oturum yok olur.
- **B:** Gizli mod kullanılamıyorsa (izin verilmemiş veya kurumsal politika
  kapalı) `chrome.browsingData.remove` ile **yalnızca hedef origin'in**
  çerez/localStorage/IndexedDB verisi temizlenir, normal sekmede devam edilir.

## 5. Kayıt Akışı

1. Arayüz `TESTFLOW_START_RECORDING` yollar → background hedefi açar,
   `mode:'record'` oturumu kurar
2. recorder.js capture-fazında `click` ve `change` dinler:
   - click → en yakın tıklanabilir ata (`closest('button,a,input,...')`)
   - change → `fill`/`select`; **`type=file` ise `upload`** (dosya içeriği
     değil, yalnızca adı kaydedilir)
   - Aynı alana ardışık change'ler **tek adıma tekilleştirilir**
     (`replacePrev` — araya tıklama girince zincir kırılır)
   - **Select2 desteği:** sahte dropdown'a tıklamalar kaydedilmez; seçenek
     seçimi mousedown'da yakalanıp altta yatan gerçek `<select>`'e yapılmış
     bir `select` adımına çevrilir (dinamik id'li select2 span'lerine
     bağımlılık oluşmaz)
3. **Locator aday üretimi** — her hedef eleman için skorlu adaylar:

   | Strateji | Skor |
   |---|---|
   | id | 1.00 |
   | data-testid | 0.98 |
   | name | 0.90 |
   | aria-label | 0.85 |
   | placeholder | 0.80 |
   | href (linklerde) | 0.75 |
   | CSS yolu (stabil id'ye ya da body'ye demirli, her seviyede nth-child; kayıt anında elemente çözümlendiği doğrulanır — doğrulanamazsa aday üretilmez) | 0.60 |
   | görünen metin — **bilinçli olarak son çare** (metinler sık değişir) | 0.45 |
   | dinamik görünen id / name (framework üretimi: `input-8342`, `ember123`, uuid…) | 0.40–0.42 |

   Skorlar **beklenen stabiliteye** göre dizilir; dinamik kalıplı id/name'ler
   tespit edilip en alta itilir (id olmaları güven vermez, her yüklemede değişirler).

4. **Hassas alanlar:** `type=password` veya ad/id'sinde şifre kalıbı geçen
   alanların değeri anında `***`'a çevrilir — gerçek değer eklentiden dışarı
   hiç çıkmaz. Koşum için adımın veri setine bağlanması zorunludur.
5. **✓ Doğrula modu:** çubuktaki düğme; hover'da eleman vurgulanır,
   tıklamada `assert-text` (metni varsa) / `assert-visible` adımı eklenir;
   tıklama `preventDefault` ile yutulur (sayfada işlem yapmaz).
6. Kaydı Bitir → adımlar bridge üzerinden arayüze döner; arayüz
   `POST /api/scenarios` ile senaryoyu oluşturur ve detaya yönlendirir.

## 6. Koşum Akışı

1. **Binding çözümü arayüzde yapılır** (ScenarioDetail / toplu koşum /
   tekrar koşum): `dataBinding` olan adımların `value`'su seçilen setten
   doldurulur; dosya girdilerinde `fileName` da adıma eklenir. Eksik anahtar
   koşum başlamadan anlaşılır hata verir. Ortam seçildiyse başlangıç
   URL'inin yalnızca origin'i değiştirilir (path korunur).
2. `TESTFLOW_START_RUN` → background temiz-oturum A/B planıyla sekmeyi açar,
   `mode:'play'` oturumu kurar.
3. player.js her adımda:
   - **Element arama:** adaylar skor sırasıyla, 250ms aralıklarla, süre
     dolana dek denenir. Süre önceliği: `Step.meta.timeoutMs` → koşum
     varsayılanı (`runConfig.defaultTimeoutMs`; arayüzde senaryo → ortam →
     proje sırasıyla çözülür) → 5sn. Adımda süre yoksa oranlar: assert
     **2,4×** (sayfa geçişi/yavaş yükleme), opsiyonel **0,6×** (bazen gelen
     modallar koşumu bekletmesin). `meta.waitFor`: `visible` (vars.),
     `enabled` (aktif + `elementFromPoint` ile üstü kapalı değil), `exists`.
     Click adımları disabled elementin aktifleşmesini her koşulda bekler.
   - **Zaman damgaları:** her sonuçta `startedAt` / `locatedAt` (element
     bulundu) / `finishedAt` (epoch ms) → `RunStepResult`'ta Instant.
     `GET /api/runs/step-stats` son 30 günün bekleme istatistiğini döner.
   - **Snapshot:** her sonuçta `stepSnapshot` (adımın o anki tanımı; hassas
     ve bağlı değerler yazılmaz) — senaryo değişse de geçmiş okunur.
   - **Tür doğrulaması:** fill yalnızca INPUT/TEXTAREA ve kayıttaki
     `inputType` ile eşleşen elemana; select yalnızca SELECT'e; upload
     yalnızca `input[type=file]`'a uygulanır. Bu, self-healing'in yanlış
     elemana "iyileşmesini" (örn. şifreyi kullanıcı adına yazmasını) engeller.
   - **Aksiyonlar:** click = tam olay zinciri (pointerdown→mousedown→focus→
     pointerup→mouseup→click, merkez koordinatlarla — salt `el.click()`
     bazı sitelerde tetiklenmez); fill/select = native value setter +
     input/change event'leri (React/Vue kontrollü inputlar için şart);
     upload = base64 → `File` → `DataTransfer` → `input.files` ataması;
     assert-text = **element + metin birlikte**, süre dolana dek yeniden
     denenir (SPA'da element hemen var ama içerik geç değişebilir).
   - **Bayraklar:** `ifEmpty` → alan dolu/kilitliyse (disabled/readonly)
     dokunulmaz, `skipped`; `optional` → her tür başarısızlık `failed`
     yerine `skipped` olur ve koşum devam eder.
   - **Ekran görüntüsü:** aksiyondan hemen önce background'dan
     `captureVisibleTab` (JPEG q50) istenir; başarısızlıkta da alınır.
4. Adım `failed` olursa kalanlar `skipped` işaretlenir, koşum biter.
5. `PLAY_DONE` → sonuçlar arayüze döner → arayüz `POST /api/runs` ile
   kaydeder → **healed adımlar varsa kalıcılaştırma** (bkz. §7) →
   Koşumlar sayfasına yönlenir.

**Toplu koşum** tamamen arayüz orkestrasyonudur: seçili senaryolar için
sırayla `runOne` çağrılır; her koşumun RUN_DONE'u bir Promise resolver ile
beklenir. Eklenti tek oturum yönettiği için koşumlar paraleldir değil,
sıralıdır.

**Adım kimliği:** `PATCH /scenarios/{id}` adımları id'ye göre upsert eder
(UUID korunur). `RunStepResult.stepId` bu sayede kalıcı olarak doğru adımı
gösterir.

**Önkoşullar:** `Scenario.preconditionIds` (sıralı, virgüllü) +
`preconditionText`. `PreconditionService` döngü/derinlik (≤3) doğrular;
`GET /scenarios/precondition-chain?ids=` zinciri koşum sırasıyla (DFS,
tekilleştirilmiş) döner. `lib/run.js#prepareRun` adımları birleştirir:
önkoşul adımları (`meta.precondition` işaretli) → sentetik `goto` →
senaryo adımları. Başarısız önkoşul adımı koşumu `blocked` yapar.

**Araya kayıt:** `START_RECORD_FROM` → önce `mode:'play', thenRecord`
ile ön adımlar oynatılır; `PLAY_DONE`'da hepsi geçtiyse oturum aynı sekmede
`mode:'record'`'a döner ve recorder `scripting.executeScript` ile yeniden
enjekte edilir (sayfa yüklenirken çalışan kopya "kayıt yok" deyip çıkmıştı;
`window.__tfRecorderActive` çift dinleyiciyi engeller). `RECORDING_DONE`
`insertContext` taşır; senaryo detayı adımları ekleme noktasına yerleştirir.

**Doğal dil:** recorder kayıtta `meta.label` + `meta.elementKind` yakalar;
`lib/describe.js` cümle üretir (Türkçe ekler etikete değil öğe türüne
bağlı). `meta.description` kullanıcı açıklamasıdır.

## 7. Self-Healing ve Kalıcılaştırma

- Koşumda ilk aday bulunamayıp sonraki bir aday tutarsa adım geçer ve
  `healed=true`, `healedStrategy=<strateji>` işaretlenir.
- Koşum sonrası arayüz, healed adımların **çalışan stratejisinin skorunu
  mevcut maksimumun üzerine çıkarıp** senaryoyu PATCH'ler — bir sonraki
  koşumda o strateji ilk denenir. Yani senaryo bir koşumda kendini onarır.
- Tür doğrulaması (§6) yanlış-eleman iyileşmesini engellediği için hatalı
  kalıcılaştırma riski düşüktür.
- Healed sayıları koşum özetinde ve dashboard'da görünür — "arayüz değişti,
  senaryolara bak" sinyalidir.

## 8. Frontend Notları

- React 18 + Vite (Node 16 uyumu için Vite 4'te tutuluyor; Node 20+'a
  geçilince Vite 5'e dönülebilir), react-router v6.
- Kimlik: JWT `sessionStorage`'da; `api()` yardımcı fonksiyonu her isteğe
  Bearer ekler, 401'de login'e atar. Vite dev proxy `/api` → `:8080`
  (CORS'a takılmadan; `localhost` VE `127.0.0.1` origin'leri backend
  CORS listesinde olmalı).
- Koşum listesi **özet DTO** döner (adım/fail/healed sayılarıyla);
  ekran görüntüleri yalnızca `GET /runs/{id}` detayında taşınır
  (liste payload'ının MB'larca şişmesini önlemek için).
- Tema: `styles.css`'te CSS değişkenleri (token'lar) — renk/tipografi tek
  yerden yönetilir.

## 9. Bilinen Sınırlar ve Yol Haritası

| Sınır | Durum / Plan |
|---|---|
| H2 in-memory: restart'ta veri gider | Pilot için bilinçli tercih; kalıcılık için `jdbc:h2:file` veya PostgreSQL/MSSQL (yalnızca config + driver). Görüntüler o aşamada diske taşınmalı (DB'de yol tutulur) |
| Zamanlanmış/headless koşum yok | Eklenti mimarisinin doğal sınırı. Plan: player mantığının Spring + Playwright worker'a taşınması (adım/locator modeli buna hazır) → CI/CD ve zamanlama bunun üzerine gelir |
| iframe içi kayıt/koşum | Recorder frame bilgisi toplayabilir ama player kullanmıyor; ihtiyaç geldiğinde eklenecek |
| Aksiyon seti | hover, sürükle-bırak, yeni sekme takibi henüz yok (`wait`, `goto`, `press` var) |
| Önkoşul adımlarında healing | Önkoşul adımları iyileşirse kalıcılaştırma yalnız ana senaryoya uygulanır; önkoşul senaryosu kendi koşumunda kalıcılaşır |
| Ekran görüntüsü kotası | `captureVisibleTab` ~2/sn ile sınırlı; çok hızlı adımlarda tek tük kare boş kalabilir (koşumu etkilemez) |
| Dosya girdisi ≤3MB | H2 in-memory + storage.session sınırları; kalıcı depoya geçişte artırılabilir |
| Senaryo sürüm geçmişi yok | Talebe göre eklenecek |

## 10. Yerelde Çalıştırma (özet)

```bash
# Backend  (Java 17+, Maven)
cd backend && mvn spring-boot:run          # :8080, H2 console: /h2-console

# Frontend (Node 16+)
cd frontend && npm install && npm run dev  # :5173

# Eklenti: chrome://extensions → Geliştirici modu → Paketlenmemiş öğe yükle
#          → extension/ klasörü → "Gizli modda izin ver"
```

Demo kullanıcıları ve ayrıntılar için `README.md`, son kullanıcı akışları
için `KULLANIM-KILAVUZU.md`.
