-- =============================================================================
-- TestFlow — PostgreSQL kurulumu, adım 1/3: rol ve veritabanı
--
-- Kim çalıştırır : DBA (süper kullanıcı, örn. postgres)
-- Nereye bağlıyken: "postgres" veritabanı
-- Gereksinim     : PostgreSQL 16 veya üzeri, ICU desteği (resmî kurulumlarda bulunur)
--
-- ÇALIŞTIRMADAN ÖNCE: Aşağıdaki şifreyi değiştirin. Test ve canlı ortam için
-- farklı şifreler kullanın. Dosyanın şifre yazılmış hâlini paylaşmayın ve Git'e
-- eklemeyin; dosyayı kaydetmeden çalıştırmak ya da şifreyi sonradan ALTER ROLE
-- ile atamak daha güvenlidir.
-- =============================================================================

-- Uygulamanın bağlanacağı rol. Şema sahibi olacağı için tablo oluşturup
-- değiştirebilir (ileride şema güncellemelerini uygulama kendisi yapacak);
-- sunucudaki başka hiçbir veritabanına yetkisi yoktur.
CREATE ROLE testflow_app
    LOGIN
    PASSWORD 'BURAYA_GUCLU_BIR_SIFRE_YAZIN'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
    CONNECTION LIMIT 50;

-- Veritabanı: UTF-8, Türkçe sıralama (ICU tr-TR). Türkçe sıralama sonradan
-- değiştirilemediği için burada ayarlanması önemlidir: "ı/i/İ/I", "ç", "ş" vb.
-- harfler doğru sırada listelenir.
CREATE DATABASE testflow
    WITH OWNER = testflow_app
         ENCODING = 'UTF8'
         LOCALE_PROVIDER = icu
         ICU_LOCALE = 'tr-TR'
         TEMPLATE = template0;

-- Yalnız uygulama rolü bağlanabilsin
REVOKE CONNECT ON DATABASE testflow FROM PUBLIC;
GRANT CONNECT ON DATABASE testflow TO testflow_app;
