-- =============================================================================
-- TestFlow — PostgreSQL kurulumu, adım 2/3: şema ve yetkiler
--
-- Kim çalıştırır : DBA (süper kullanıcı)
-- Nereye bağlıyken: "testflow" veritabanı  (adım 1'de oluşturuldu)
-- =============================================================================

-- Tablolar "public" yerine ayrı bir şemada durur; sahibi uygulama rolüdür.
CREATE SCHEMA IF NOT EXISTS testflow AUTHORIZATION testflow_app;

-- "public" şemasına kimse nesne oluşturamasın
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Uygulama bağlandığında varsayılan olarak testflow şemasını kullanır
ALTER ROLE testflow_app IN DATABASE testflow SET search_path = testflow;

-- Oturumlar UTC ile çalışsın (zaman damgaları timestamptz olarak tutulur;
-- uygulama zamanları zaten UTC gönderir, bu ayar yalnız tutarlılık içindir)
ALTER ROLE testflow_app IN DATABASE testflow SET timezone = 'UTC';
