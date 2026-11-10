# TestFlow — PostgreSQL Kurulumu

Bu klasördeki script'ler TestFlow'un veritabanını, uygulama kullanıcısını ve
tablolarını oluşturur. **PostgreSQL 16 veya üzeri** gerekir (resmi kurulumlarda
bulunan ICU desteği Türkçe sıralama için kullanılır).

## Çalıştırma sırası

| Adım | Script | Kim çalıştırır | Hangi veritabanına bağlıyken |
|---|---|---|---|
| 1 | `00_rol_ve_veritabani.sql` | DBA (süper kullanıcı) | `postgres` |
| 2 | `01_sema_ve_yetkiler.sql` | DBA (süper kullanıcı) | `testflow` |
| 3 | `02_tablolar.sql` | **`testflow_app`** | `testflow` |

> **Adım 1'den önce** `00_rol_ve_veritabani.sql` içindeki
> `BURAYA_GUCLU_BIR_SIFRE_YAZIN` değerini güçlü bir şifreyle değiştirin. Şifreli
> hali paylaşmayın ve Git'e eklemeyin.
>
> **Adım 3'ün uygulama kullanıcısıyla çalıştırılması önemlidir:** tabloların
> sahibi `testflow_app` olur, böylece uygulama ileride şema güncellemelerini
> kendisi yapabilir. DBA hesabıyla çalıştırılırsa tablolar DBA'ya ait olur ve
> uygulama bunları değiştiremez.

### psql ile

```bash
psql -h <sunucu> -U postgres -d postgres     -v ON_ERROR_STOP=1 -f 00_rol_ve_veritabani.sql
psql -h <sunucu> -U postgres -d testflow     -v ON_ERROR_STOP=1 -f 01_sema_ve_yetkiler.sql
psql -h <sunucu> -U testflow_app -d testflow -v ON_ERROR_STOP=1 -f 02_tablolar.sql
```

### pgAdmin ile

Her script'i, tablodaki veritabanına **ilgili kullanıcıyla** bağlanmış bir Query
Tool penceresinde açıp çalıştırın. Adım 3 için pgAdmin'de `testflow_app`
kullanıcısıyla ayrı bir sunucu bağlantısı tanımlayın.

## Kurulumu doğrulama

`testflow_app` ile `testflow` veritabanına bağlanıp:

```sql
-- 9 tablo listelenmeli
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'testflow' ORDER BY table_name;

-- Varsayılan şema testflow olmalı
SHOW search_path;

-- Türkçe sıralama: icu / tr-TR olmalı
SELECT datlocprovider, daticulocale FROM pg_database WHERE datname = 'testflow';
```

Beklenen tablolar: `environments`, `folders`, `run_step_results`, `runs`,
`scenarios`, `steps`, `test_data_sets`, `workspace_members`, `workspaces`.

## Uygulamanın bağlanması

Uygulama `postgres` profiliyle başlatılır; bağlantı bilgileri ortam
değişkenlerinden okunur (dosyaya yazılmaz):

| Değişken | Örnek |
|---|---|
| `SPRING_PROFILES_ACTIVE` | `postgres` |
| `DB_URL` | `jdbc:postgresql://localhost:5432/testflow` |
| `DB_USERNAME` | `testflow_app` |
| `DB_PASSWORD` | *(adım 1'de belirlenen şifre)* |

Uygulama açılışta şemayı doğrular (`ddl-auto=validate`) ve şemayı kendisi
değiştirmez; tablolar entity'lerle uyuşmazsa açılmaz ve günlükte hangi kolonun
uyuşmadığını yazar.

## Mevcut verilerin taşınması

Script'ler boş tablolar oluşturur. Eski sistemdeki (H2) senaryoları taşımak için:

1. **Eski sistemde:** TestFlow → **Aktarım** → "Üyesi olduğum tüm projeler" →
   **⬇ Dışa aktar**. Ortak projelerde içeriğin tamamı için, o projelerin
   üyesi olan bir kullanıcıyla yapın.
2. **Yeni sunucuda:** Uygulamayı `postgres` profiliyle başlatın, AD hesabınızla
   giriş yapın (ilk girişte kişisel alanınız oluşur).
3. **Aktarım** → **📄 Dosya seç** → önizlemeyi kontrol edin → **⬆ İçe aktar**.
4. Kullanıcı adları değiştiyse **Proje Üyeleri** sayfasından üyelikleri
   güncelleyin. Birkaç senaryoyu koşup sonuçları doğrulayın.
5. Dışa aktarma dosyası şifre içerdiği için işiniz bitince silin. Eski H2
   veritabanı dosyasını (`backend/data/`) bir süre yedek olarak saklayın.

## Notlar

- **Kullanıcılar veritabanında tutulmaz;** kimlik doğrulama LDAP/Active
  Directory üzerinden yapılır. Tablolarda yalnız kullanıcı adları geçer.
- **Gizli veri:** `test_data_sets.entries` kolonu test kullanıcılarının
  şifrelerini içerebilir. Veritabanı yedeklerine erişim buna göre
  kısıtlanmalıdır.
- **Büyüme:** Verinin büyük kısmı `run_step_results.screenshot` kolonundaki
  ekran görüntüleridir. PostgreSQL bu kolonu otomatik sıkıştırır; yine de koşum
  sayısına bağlı olarak ayda birkaç GB büyüme beklenebilir.
- **Koşum geçmişi** silinen senaryo/ortam/veri setinin kimliğini bilerek saklar;
  bu yüzden bazı kimlik kolonlarında yabancı anahtar yoktur (ayrıntı
  `02_tablolar.sql` başındaki notlarda).
- **Yedekleme:** `pg_dump -Fc -d testflow` ile tam yedek alınabilir; kurum
  standardındaki günlük yedeklemeye dahil edilmesi önerilir.
