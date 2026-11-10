# TestFlow — PostgreSQL Kurulumu

Bu klasördeki script'ler TestFlow'un veritabanını, uygulama kullanıcısını ve
tablolarını oluşturur. **PostgreSQL 16 veya üzeri** gereklidir (resmî kurulum
paketlerinde bulunan ICU desteği, Türkçe sıralama için kullanılır).

Kurulum, uygulamanın çalışacağı her iki sunucuda ayrı ayrı yapılır. Önce test
ortamında yapılması, sorun yaşanmazsa canlı ortama geçilmesi önerilir.

| Ortam | Sunucu | IP adresi |
|---|---|---|
| Test | sjcrtflowt01 | 10.10.40.97 |
| Canlı | sjcrtflowp01 | 10.10.30.197 |

## Çalıştırma sırası

| Adım | Script | Kim çalıştırır | Hangi veritabanına bağlıyken |
|---|---|---|---|
| 1 | `00_rol_ve_veritabani.sql` | DBA (süper kullanıcı) | `postgres` |
| 2 | `01_sema_ve_yetkiler.sql` | DBA (süper kullanıcı) | `testflow` |
| 3 | `02_tablolar.sql` | **`testflow_app`** | `testflow` |

> **Adım 1'den önce** `00_rol_ve_veritabani.sql` dosyasındaki
> `BURAYA_GUCLU_BIR_SIFRE_YAZIN` ifadesini güçlü bir şifreyle değiştirin. Test ve
> canlı ortam için farklı şifreler kullanın. Dosyanın şifre yazılmış hâlini
> paylaşmayın ve Git'e eklemeyin.
>
> **Adım 3'ün uygulama kullanıcısıyla çalıştırılması önemlidir:** Böylece
> tabloların sahibi `testflow_app` olur ve uygulama ileride şema güncellemelerini
> kendisi yapabilir. Bu adım DBA hesabıyla çalıştırılırsa tablolar DBA'ya ait olur
> ve uygulama bunları değiştiremez.

### psql ile

```bash
psql -h <sunucu> -U postgres -d postgres     -v ON_ERROR_STOP=1 -f 00_rol_ve_veritabani.sql
psql -h <sunucu> -U postgres -d testflow     -v ON_ERROR_STOP=1 -f 01_sema_ve_yetkiler.sql
psql -h <sunucu> -U testflow_app -d testflow -v ON_ERROR_STOP=1 -f 02_tablolar.sql
```

### pgAdmin ile

Her dosyayı, tabloda belirtilen veritabanına **ilgili kullanıcıyla** bağlanılmış
bir Query Tool penceresinde açıp çalıştırın. Adım 3 için pgAdmin'de
`testflow_app` kullanıcısıyla ayrı bir sunucu bağlantısı tanımlayın.

## Erişim

Uygulama veritabanıyla aynı sunucuda çalıştığı için bağlantı yalnızca yerel
olarak (localhost üzerinden) yapılır. `pg_hba.conf` dosyasına aşağıdaki
kuralların eklenmesi yeterlidir; 5432 portunun güvenlik duvarında dışarıya
açılmasına gerek yoktur:

```
host  testflow  testflow_app  127.0.0.1/32  scram-sha-256
host  testflow  testflow_app  ::1/128       scram-sha-256
```

## Kurulumu doğrulama

`testflow_app` kullanıcısıyla `testflow` veritabanına bağlanarak aşağıdaki
sorguları çalıştırın:

```sql
-- 9 tablo listelenmeli
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'testflow' ORDER BY table_name;

-- Varsayılan şema testflow olmalı
SHOW search_path;

-- Türkçe sıralama: datlocprovider = i (ICU), daticulocale = tr-TR olmalı
SELECT datlocprovider, daticulocale FROM pg_database WHERE datname = 'testflow';
```

Beklenen sonuçlar:

| Sorgu | Beklenen |
|---|---|
| Tablo listesi | 9 tablo |
| `SHOW search_path` | `testflow` |
| Sıralama | `datlocprovider` = `i` (ICU anlamına gelir), `daticulocale` = `tr-TR` |

Beklenen tablolar: `environments`, `folders`, `run_step_results`, `runs`,
`scenarios`, `steps`, `test_data_sets`, `workspace_members`, `workspaces`.

## Uygulamanın bağlanması

Uygulama `postgres` profiliyle başlatılır. Bağlantı bilgileri ortam
değişkenlerinden okunur, herhangi bir dosyaya yazılmaz:

| Değişken | Örnek |
|---|---|
| `SPRING_PROFILES_ACTIVE` | `postgres` |
| `DB_URL` | `jdbc:postgresql://localhost:5432/testflow` |
| `DB_USERNAME` | `testflow_app` |
| `DB_PASSWORD` | *(adım 1'de belirlenen şifre)* |

Uygulama açılışta şemayı doğrular (`ddl-auto=validate`), şemayı kendisi
değiştirmez. Tablolar uygulamanın beklediği yapıyla uyuşmazsa uygulama açılmaz ve
günlük kaydına hangi kolonun uyuşmadığını yazar.

## Mevcut verilerin taşınması

SQL dosyaları boş tablolar oluşturur. Eski sistemdeki (H2) senaryoları taşımak
için:

1. **Eski sistemde:** TestFlow → **Aktarım** → "Üyesi olduğum tüm projeler" →
   **⬇ Dışa aktar**. Ortak projelerin tamamının aktarılması için bu işlemi, o
   projelerin üyesi olan bir kullanıcıyla yapın.
2. **Yeni sunucuda:** Uygulamayı `postgres` profiliyle başlatın, AD hesabınızla
   giriş yapın (ilk girişte kişisel alanınız oluşur).
3. **Aktarım** → **📄 Dosya seç** → önizlemeyi kontrol edin → **⬆ İçe aktar**.
4. Kullanıcı adları değiştiyse **Proje Üyeleri** sayfasından üyelikleri
   güncelleyin. Birkaç senaryoyu koşup sonuçları doğrulayın.
5. Dışa aktarma dosyası şifre içerdiği için işiniz bitince silin. Eski H2
   veritabanı dosyasını (`backend/data/`) bir süre yedek olarak saklayın.

## Notlar

- **Kullanıcılar veritabanında tutulmaz.** Kimlik doğrulama LDAP/Active
  Directory üzerinden yapılır; tablolarda yalnızca kullanıcı adları yer alır.
- **Gizli veri:** `test_data_sets.entries` kolonu, test kullanıcılarına ait
  şifreleri içerebilir. Bu nedenle veritabanı yedeklerine erişim yetkili
  kişilerle sınırlandırılmalıdır.
- **Büyüme:** Verinin büyük kısmı `run_step_results.screenshot` kolonundaki
  ekran görüntüleridir. PostgreSQL bu kolonu otomatik sıkıştırır; yine de koşum
  sayısına bağlı olarak ayda birkaç GB büyüme beklenebilir.
- **Koşum geçmişi**, silinen senaryo, ortam ve veri setlerinin kimliklerini
  bilinçli olarak saklar. Bu nedenle bazı kimlik kolonlarında yabancı anahtar
  bulunmaz (ayrıntılar `02_tablolar.sql` dosyasının başındaki notlarda).
- **Yedekleme:** `pg_dump -Fc -d testflow` komutuyla tam yedek alınabilir.
  Veritabanının kurum standartlarındaki günlük yedeklemeye dâhil edilmesi
  önerilir. Öncelik canlı ortamdır; test ortamı için daha kısa bir saklama
  süresi yeterlidir.
