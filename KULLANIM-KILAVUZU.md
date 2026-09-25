# TestFlow Kullanım Kılavuzu

TestFlow, kod bilmeden web testleri kaydetmenizi, düzenlemenizi ve koşmanızı
sağlar. Bu kılavuz tüm özellikleri kullanım sırasına göre anlatır.

---

## 1. Giriş ve Projeler

- **Giriş:** Şirket (Active Directory) kullanıcı adı ve şifrenizle giriş
  yapılır. Kayıt olmaya gerek yoktur.
- **Kişisel Alan:** İlk girişte size özel bir alan açılır — yalnızca siz
  görürsünüz. Denemelerinizi burada yapabilirsiniz.
- **Projeler:** Ekiple çalışmak için sol üstteki listeden **＋ Yeni proje**
  oluşturun ve **Proje Üyeleri** sayfasından arkadaşlarınızı AD kullanıcı
  adıyla ekleyin. Bir kullanıcı birden fazla projede olabilir; sol üstten
  proje değiştirilir. **Farklı projeler birbirinin verisini göremez.**
- **Paylaşım:** Senaryolar ("Kopyala →" / "Çoğalt") ve test veri setleri
  üyesi olduğunuz projelere **bağımsız kopya** olarak kopyalanır — kopyayı
  değiştirmek orijinali etkilemez.

## 2. Tarayıcı Eklentisi (bir kez kurulur)

Kayıt ve koşum, Chrome/Edge eklentisiyle yapılır.

1. `chrome://extensions` (Edge: `edge://extensions`) adresini açın
2. Sağ üstten **Geliştirici modu**nu açın
3. **Paketlenmemiş öğe yükle** → repodaki `extension/` klasörünü seçin
4. **Ayrıntılar → Gizli modda izin ver** anahtarını açın (önerilir — bkz. §7)
5. TestFlow sekmesini yenileyin — Senaryolar sayfasının sağ üstünde
   **Eklenti vX.X.X** yazısı görünmelidir

> Eklenti güncellendiğinde `chrome://extensions` sayfasından 🔄 **yenile**
> yapmayı unutmayın; sürüm numarası arayüzdekiyle eşleşmelidir.

## 3. Senaryo Kaydetme

1. **Senaryolar → + Yeni Senaryo**
2. Senaryo adını girin; başlangıç adresini **ortamdan seçin** ya da
   "Elle URL gir…" ile yazın
3. **🔴 Kaydı Başlat** — hedef site yeni (tercihen gizli) pencerede açılır,
   sağ üstte kayıt çubuğu görünür
4. Testi normal kullanır gibi yapın: tıklamalar, form doldurma, seçimler ve
   **dosya seçimleri** otomatik adım olarak kaydedilir
5. **Doğrulama eklemek için** (opsiyonel ama önerilir): çubuktaki yeşil
   **✓ Doğrula** düğmesine basın → doğrulamak istediğiniz öğenin üzerine
   gelin (yeşil çerçeveyle vurgulanır) → tıklayın. "Bu metin/öğe görünüyor
   olmalı" anlamında bir adım eklenir ve normal kayda dönülür
6. **Kaydı Bitir** — TestFlow'a dönersiniz, senaryo adımlarıyla hazırdır

**Bilinmesi iyi olanlar:**
- **Şifre alanları asla kaydedilmez** — kayıtta `***` olarak maskelenir.
  Koşabilmek için bu adımı bir test verisi anahtarına bağlamanız gerekir (§5).
- Aynı alana arka arkaya yazarsanız tek adım oluşur (tekrar tekrar yazım
  ayrı adımlar üretmez).

## 4. Senaryo Düzenleme

Senaryo detayında:

- **Ad** başlığa tıklanarak, **başlangıç URL** ortam seçilerek ya da elle,
  **klasör** yanındaki listeden değiştirilir — sonra **Kaydet**
- Adımlar **↑ ↓** ile taşınır, **✕** ile silinir
- Her adımın üstünde ne yaptığı düz Türkçe yazar ("'Giriş Yap' butonuna
  tıkla"). Açıklamaya tıklayıp kendi cümlenizi yazabilirsiniz; boş
  bırakırsanız otomatik açıklamaya döner. Altında ilk locator görünür.

**Araya adım ekleme:** Adımların arasındaki **＋ Buraya adım ekle**
(en üstte **＋ Başa adım ekle**) ile:

- **⏺ Kayıtla ekle** — ortam ve (gerekiyorsa) veri seti seçip Başlat'a
  basın. Açılan pencerede o noktaya kadarki adımlar (önkoşullar dahil)
  oynatılır, sonra kayıt çubuğu belirir. Tıklayın, yazın, ✓ Doğrula
  kullanın ve **Kaydı Bitir**'e basın; adımlar seçtiğiniz yere eklenir.
  Önceki adımlardan biri geçmezse kayda geçilmez ve nedeni gösterilir.
- **⏱ Bekleme** / **🌐 Adrese git** — element gerektirmeyen adımlar.

Eklenen adımlar çerçeveli görünür; **Geri al** ile çıkarabilir, **Kaydet**
ile kalıcı hale getirirsiniz.

**Bekleme süresi:** Koşumda her adım, hedef öğe ekranda görünene kadar
bekler (varsayılan 5 sn; doğrulama adımlarında 2,4 katı). Süre dört
seviyede ayarlanır, en özel olan geçerlidir: **adım** (adımın altındaki
⏱ kutusu) → **senaryo** (başlıktaki "Bekleme") → **ortam** (Ortamlar
sayfası) → **proje** (Proje sayfası). Adım altındaki listeden bekleme
koşulu da seçilir: *görünür olsun* (varsayılan), *tıklanabilir olsun*
(öğe aktif ve üstünde yükleniyor katmanı yok — sahte hata veren
spinner'lı ekranlar için), *sayfada olsun* (gizli öğeler için). Adımın
yanında son koşumlardaki ortalama/en uzun bulunma süresi görünür; süreye
yaklaşan adımlar ⚠ ile işaretlenir.

**Önkoşullar:** Senaryonun üstündeki **＋ Önkoşul ekle** ile:

- *Açıklayıcı önkoşul* — "kullanıcının onay yetkisi olmalı" gibi bilgi
  notu; koşulmaz.
- *Önce koşulacak senaryolar* — örn. "Login" senaryosunu bir kez yazıp
  diğer senaryolara önkoşul olarak ekleyin. Koşumda önce önkoşullar,
  sonra senaryo aynı pencerede koşar. Önkoşul başarısız olursa senaryo
  koşulmaz ve sonuç **blocked** olur ("login bozuk" ile "bu ekran bozuk"
  ayrımı). En fazla 3 seviye iç içe olabilir; döngüye izin verilmez.
  Önkoşul olarak kullanılan bir senaryo, kullanan senaryolardan
  çıkarılmadan silinemez. Başka projeye kopyalarken önkoşulları da
  birlikte kopyalanır.

**Adım bayrakları:**

| Bayrak | Ne yapar | Ne zaman kullanılır |
|---|---|---|
| **gizli** | Değer maskelenir | Şifre, TC no gibi hassas değerler |
| **boşsa** | Alan doluysa veya kilitliyse (disabled) dokunulmaz, adım atlanır; boşsa doldurulur | Dosyadan dosyaya dolu gelebilen alanlar |
| **ops.** | Öğe bulunamazsa/adım başarısız olursa koşum kesilmez, adım atlanır | Bazen gelen modallar, koşullu alanlar |

**Aksiyon türleri:** `goto` (adrese git), `click` (tıkla), `fill` (yaz), `select` (listeden seç),
`upload` (dosya yükle), `press` (tuş bas — kayıtta Enter otomatik yakalanır),
`wait` (değerdeki saniye kadar bekle — yavaş yüklenen ekranlar için elle
eklenir), `assert-text` (metin görünmeli), `assert-visible` (öğe görünmeli).

## 5. Test Verileri

Senaryolara sabit değer yazmak yerine değerleri merkezi setlerde tutun:

1. **Test Verileri → + Yeni Veri Seti**
2. Anahtar ekleyin: `kullanici_email`, `sifre`, `fatura_pdf` gibi
3. Tipini seçin: **metin** ya da **dosya** (dosya en fazla 3MB)
4. Hassas değerlerde **gizli** işaretleyin — maskeli görünür

**Bağlama (📎):** Senaryo detayında bir fill/select/upload adımının
listesinden 📎'li anahtarı seçin → **Kaydet**. Koşum sırasında değer,
seçtiğiniz setten alınır.

- Şifre adımları **bağlanmak zorundadır** (kayıt sırasında saklanmadığı için)
- upload adımları yalnızca **dosya** tipli anahtarlara bağlanabilir
- Aynı senaryoyu farklı setlerle koşarak farklı verilerle test edebilirsiniz
  (örn. "Geçerli Kullanıcı" seti ile passed, "Yanlış Şifre" seti ile failed)

## 6. Ortamlar

**Ortamlar** sayfasında test/staging/prod gibi ortamları ad + baseUrl ile
tanımlayın. Kullanım yerleri:

- Senaryo oluştururken/düzenlerken başlangıç URL'i ortamdan seçilir
- Koşum başlatırken ortam seçerseniz senaryo o ortamın adresinde koşar
  (URL'in yolu korunur, sadece sunucu kısmı değişir)

## 7. Koşum

Senaryo detayında **▶ Koş** → ortam ve test verisi seçin → **Başlat**.
Senaryo yeni pencerede oynatılır; çubukta ilerleme görünür; bitince sonuç
otomatik kaydedilir ve Koşumlar sayfası açılır.

**Temiz oturum:** Eklentiye gizli mod izni verildiyse koşum **gizli
pencerede** yapılır — her koşum login'siz, sıfırdan başlar, bitince oturum
silinir. Gizli mod şirket politikasıyla kapalıysa sistem otomatik olarak
**hedef sitenin çerezlerini temizleyip** normal sekmede koşar; sonuç aynıdır
(dikkat: bu, sizin o sitedeki oturumunuzu da kapatır).

**Koşum sırasında beklemeler:** Öğeler 5 sn aranır; doğrulamalar sayfa
geçişlerini 12 sn'ye kadar bekler; opsiyonel adımlar 3 sn bekler.

**Data-driven koşum (bir senaryo × çok veri):** Koşum panelinde birden
fazla veri seti işaretlerseniz senaryo her setle ayrı ayrı, sırayla koşar —
her set ayrı koşum kaydı olur. Örnek: "Geçerli Müşteri", "Eksik Alan",
"Yanlış Format" setleriyle tek tıkla üç test.

**Toplu koşum:** Senaryolar sayfasında kutucuklarla senaryoları seçin →
**▶ Toplu Koş** → ortam + veri seti → Başlat. Senaryolar sırayla koşar,
ilerleme ve özet (X passed, Y diğer) canlı görünür.

**Tekrar koşum:** Koşumlar sayfasında passed olmayan koşumların yanındaki
**↻ Tekrar Koş**, senaryoyu güncel haliyle, aynı ortam ve veri setiyle
yeniden koşar. Eski kayıt silinmez; yeni koşum ayrı kayıt olarak eklenir.

## 8. Koşum Geçmişi ve Sonuçlar

**Koşumlar** sayfasında tüm geçmiş listelenir. Bir koşuma tıklayınca:

- Her adımın **tanımı** (ne yaptığı, hangi öğede, hangi değerle)
- **Durumu**: `passed` (geçti), `failed` (kaldı), `skipped` (atlandı — ops.
  veya boşsa nedeniyle; notu Hata sütununda yazar)
- **Healed** bilgisi (bkz. §9)
- **Hata mesajı** (neden kaldığı, beklenen/bulunan metin vb.)
- **Ekran görüntüsü** — adım anındaki sayfa; tıklayınca büyür

Koşum kayıtları satırdaki **Sil** ile silinebilir.

## 9. Self-Healing (Kendi Kendini Onarma)

Kayıt sırasında her öğe için 8'e kadar farklı tanımlayıcı saklanır
(id, data-testid, name, aria-label, placeholder, link adresi, CSS yolu,
görünen metin — metin en kırılgan olduğu için bilinçli olarak son çaredir).
Uygulama güncellenip bir tanımlayıcı değişse bile (örn. id değişti)
koşum diğer adaylarla öğeyi bulmaya devam eder — adım geçer ve
**healed ✓** işaretlenir.

- Healed olan adımın çalışan tanımlayıcısı **otomatik olarak senaryoya
  yazılır**: bir sonraki koşumda ilk denemede bulunur
- Dashboard'daki "İyileşen Adım" sayısı artıyorsa uygulamada arayüz
  değişiklikleri oluyor demektir — ilgili senaryoları gözden geçirin
- Güvenlik: yazı alanları tür kontrolünden geçer — şifre adımı asla
  şifre-olmayan bir alana yazmaz

## 10. Genel Bakış (Dashboard)

Giriş sayfası son 7 günün özetini verir: koşum sayısı, başarı oranı
(renk kodlu), iyileşen adım sayısı, en çok kırılan senaryolar (bakım
önceliği listesi) ve son koşumlar.

## 11. Sık Karşılaşılan Durumlar

**"Kaydı Başlat düğmesi pasif"** → Eklenti kurulu/güncel değil. §2'yi
uygulayın, sayfayı yenileyin, sağ üstte sürüm yazısını doğrulayın.

**"Gizli/boş değer" hatası** → Şifre (veya boş bırakılmış) adım test
verisine bağlanmamış. Senaryoda o adımı 📎 ile bağlayıp Kaydet'e basın.
Aynı alan için birden fazla yazma adımı oluşmuşsa fazlasını silin.

**"Element bulunamadı"** → Sayfa değişmiş olabilir (senaryoyu güncelleyin
ya da yeniden kaydedin) veya öğe o akışta hiç gelmiyordur (adımı **ops.**
yapın). Ekran görüntüsünden o anki sayfayı kontrol edin.

**"Metin doğrulaması başarısız — beklenen X, bulunan Y"** → Sayfa
beklenen içeriğe ulaşmadı. Y değeri hangi ekranda kalındığını söyler;
genelde önceki adımlardan biri gerçekte işini yapamamıştır.

**Koşum login'li başlıyor** → Gizli mod izni kapalı ve çerez temizleme
de sonuç vermiyor olabilir; §2 adım 4'ü kontrol edin.

**Alanlar bazı kayıtlarda dolu/kilitli geliyor** → İlgili adımları
**boşsa** işaretleyin (§4).

**Koşum yavaş** → Opsiyonel olmayan her kayıp öğe 5 sn beklenir; artık
gelmeyen adımları silin ya da ops. yapın.

---

*Sorun ve önerileriniz için ekip yöneticinize başvurun.*
