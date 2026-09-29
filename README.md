# TestFlow Web

Kod bilmeyen QA ekipleri için web tabanlı test otomasyon platformu.
LDAP (Active Directory) ile giriş, AD grup bazlı workspace izolasyonu.

> Masaüstü (Electron) sürüm için: [testflow](https://github.com/akaanmnn/testflow)

> Ayrıntılı teknik mimari için: [MIMARI.md](MIMARI.md) · Son kullanıcı kılavuzu: [KULLANIM-KILAVUZU.md](KULLANIM-KILAVUZU.md)

## Mimari

```
backend/    Spring Boot 3 (Java 17+) + H2 in-memory + Spring Security LDAP + JWT
frontend/   React 18 + Vite
```

- **Auth:** AD kullanıcı adı + şifre → LDAP bind → JWT (AD yalnızca kimlik doğrular)
- **Projeler:** Her kullanıcıya ilk girişte bir **Kişisel Alan** açılır.
  Kullanıcılar proje oluşturup AD kullanıcı adıyla üye ekler; bir kullanıcı
  birden fazla projede olabilir, sol üstten proje değiştirir. Farklı projeler
  birbirinin verisini göremez. Senaryolar ve test veri setleri üyesi olunan
  projelere **kopyalanarak** paylaşılır (bağımsız kopya).
- **Veritabanı:** H2 in-memory (`create-drop`) — kurulum gerektirmez, her
  restart temiz başlar. Kalıcılık gerekince `application.properties` içinden
  dosya tabanlı H2 veya PostgreSQL'e geçilebilir.
- **Mock LDAP:** Embedded UnboundID sunucusu `mock-ldap.ldif` içeriğiyle
  otomatik ayağa kalkar. Gerçek AD'ye geçiş için sadece `spring.ldap.*`
  ayarları değişir (aşağıya bakın).

## Gereksinimler

- Java 17+
- Maven 3.9+
- Node.js 20+

## Çalıştırma

```bash
# Terminal 1 — backend (http://localhost:8080)
cd backend
mvn spring-boot:run

# Terminal 2 — frontend (http://localhost:5173)
cd frontend
npm install
npm run dev
```

## Demo kullanıcıları (mock LDAP)

| Kullanıcı | Şifre | AD Grubu (=workspace) |
|---|---|---|
| ahmet.yilmaz | test123 | QA-Team |
| fatma.kaya | test123 | QA-Team |
| mehmet.celik | test123 | Backend-QA |
| zeynep.arslan | test123 | Backend-QA |

ahmet & fatma aynı workspace'i paylaşır; mehmet & zeynep farklı workspace'tedir
ve birbirlerinin senaryolarını göremezler — izolasyon demosu için ideal.

## Özellikler

- Senaryo CRUD + adım editörü (sıralama, taşıma, silme, **araya kayıtla adım ekleme**)
- **Doğal dil adımlar:** "'Giriş Yap' butonuna tıkla" — düzenlenebilir açıklama
- **Önkoşullar:** senaryo, başka senaryoları (örn. Login) önce koşar; başarısızsa `blocked`
- **Bekleme süresi:** adım → senaryo → ortam → proje; görünür / tıklanabilir / var koşulu
- **Test verisi bağlama:** adım değeri sabit yazılabilir veya test veri
  setindeki bir anahtara bağlanabilir (📎). Gizli alanlar maskelenir.
- Klasörler, ortamlar (environment), test veri setleri
- Koşum geçmişi + adım bazlı sonuçlar (healed bilgisi, adım saati, süre ve bekleme süresiyle)
- H2 console: http://localhost:8080/h2-console (JDBC URL: `jdbc:h2:mem:testflowdb`, user: `sa`)

## Gerçek Active Directory'ye geçiş

`backend/src/main/resources/application.properties` içinde:

```properties
# Embedded LDAP satırlarını (spring.ldap.embedded.*) silin/yoruma alın

spring.ldap.urls=ldap://ad.sirket.local:389
spring.ldap.base=dc=sirket,dc=local
spring.ldap.username=cn=svc-testflow,ou=ServiceAccounts,dc=sirket,dc=local
spring.ldap.password=${AD_BIND_PASSWORD}
```

AD şemasında kullanıcı `sAMAccountName` ve grup üyeliği `memberOf` ile
sorgulanır; `LdapAuthService` içindeki filtreleri buna göre güncelleyin
(kodda TODO yorumlarıyla işaretli).

## API özeti

| Endpoint | Açıklama |
|---|---|
| `POST /api/auth/login` | LDAP giriş → JWT |
| `GET/POST/PATCH/DELETE /api/scenarios` | Senaryo CRUD |
| `GET/POST/DELETE /api/folders` | Klasörler |
| `GET/POST/PATCH/DELETE /api/test-data-sets` | Test veri setleri |
| `GET/POST/DELETE /api/environments` | Ortamlar |
| `GET/POST /api/runs` | Koşum kaydı + geçmiş |
| `GET /api/health` | Sağlık kontrolü |

## Recorder Eklentisi (Chrome & Edge)

Web'den test kaydı için `extension/` klasöründeki tarayıcı eklentisi kullanılır.

**Kurulum (geliştirme):**
1. Chrome/Edge → `chrome://extensions` (Edge: `edge://extensions`)
2. Sağ üstten **Geliştirici modu**nu aç
3. **Paketlenmemiş öğe yükle** → repodaki `extension/` klasörünü seç
4. TestFlow sekmesini yenile — "Kaydı Başlat" butonu aktifleşir

**Akış:** Senaryolar → Yeni Senaryo → ad + URL gir → **Kaydı Başlat** →
hedef site yeni sekmede açılır, sağ üstte kayıt çubuğu görünür → tıklama ve
form doldurma işlemleri otomatik adım olarak toplanır (şifre alanları maskelenir) →
**Kaydı Bitir** → TestFlow'a dönülür, senaryo adımlarıyla hazır gelir.

Her adım için çoklu locator adayı toplanır (id, data-testid, name, aria-label,
placeholder, metin, CSS yolu) — self-healing koşum motorunun temelini oluşturur.

**Şirket dağıtımı:** Eklenti, grup ilkesiyle (ExtensionInstallForcelist)
zorunlu kurulabilir veya paketlenip iç mağazadan dağıtılabilir.

## Koşum (Play)

Senaryo detayında **▶ Koş** → ortam ve test veri seti seçilir → eklenti
senaryoyu yeni sekmede oynatır:

- Her adımda locator adayları skor sırasıyla denenir; ilk aday başarısız
  olup bir sonraki tutarsa adım **healed** olarak işaretlenir (self-healing).
- 📎 ile test verisine bağlı adımların değeri, seçilen veri setinden koşum
  anında çözülür — gizli değerler (şifre vb.) senaryoya asla yazılmaz.
- Ortam seçilirse başlangıç URL'inin origin'i ortamın baseUrl'i ile değiştirilir.
- Koşum bitince sonuçlar otomatik olarak backend'e kaydedilir ve
  **Koşumlar** sayfası açılır (adım bazlı durum + healed bilgisi).

## Temiz oturumla koşum (gizli pencere)

Kayıt ve koşumlar, eklentiye gizli mod izni verildiyse **gizli pencerede** yapılır:
her koşum sıfır çerezle (login'siz) başlar, bitince pencere kapanır ve oturum
silinir. Kullanıcının normal tarayıcı oturumları etkilenmez.

İzin vermek için (bir kez): `chrome://extensions` → TestFlow Recorder →
**Ayrıntılar** → **Gizli modda izin ver** (Edge: InPrivate'ta izin ver).
İzin verilmezse koşumlar normal sekmede yapılır — önceki koşumun oturumu
açık kalabilir ve login senaryoları bundan etkilenebilir.
