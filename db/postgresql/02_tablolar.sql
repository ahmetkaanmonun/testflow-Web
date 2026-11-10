-- =============================================================================
-- TestFlow — PostgreSQL kurulumu, adım 3/3: tablolar, indeksler, kısıtlar
--
-- Kim çalıştırır : testflow_app (uygulama rolü) — tabloların sahibi o olur
-- Nereye bağlıyken: "testflow" veritabanı
--
-- Kolon adları ve türleri uygulamanın JPA eşlemeleriyle (backend/.../entity)
-- birebir uyumludur; uygulama açılışta şemayı doğrular (ddl-auto=validate).
-- Entity'lerde değişiklik yapılırsa bu dosya (ileride Flyway geçişleri)
-- birlikte güncellenmelidir.
--
-- Tasarım notları
-- * Kimlikler (id) uygulamanın ürettiği UUID metinleridir (36 karakter).
-- * Zaman damgaları timestamptz (UTC) olarak tutulur.
-- * Kullanıcılar veritabanında değil LDAP/Active Directory'de tutulur;
--   tablolarda yalnız kullanıcı adları (username) geçer.
-- * Koşum geçmişi (runs) silinen senaryo/ortam/veri setinin kimliğini
--   bilerek saklar (geçmiş korunur). Bu yüzden runs.scenario_id,
--   runs.environment_id, runs.test_data_set_id ve scenarios.folder_id
--   kolonlarında yabancı anahtar YOKTUR — eklenirse uygulamanın bugünkü
--   silme işlemleri hata verir.
-- =============================================================================

SET search_path TO testflow;

-- -----------------------------------------------------------------------------
-- Projeler (çalışma alanları)
-- -----------------------------------------------------------------------------
CREATE TABLE workspaces (
    id                  varchar(36)   NOT NULL,
    name                varchar(255)  NOT NULL,
    owner_username      varchar(255)  NOT NULL,
    personal            boolean       NOT NULL DEFAULT false,
    default_timeout_ms  integer,
    created_at          timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT pk_workspaces PRIMARY KEY (id)
);
COMMENT ON TABLE  workspaces IS 'Projeler. Her kullanıcının bir kişisel projesi (personal=true) ve üyesi olduğu ortak projeleri vardır.';
COMMENT ON COLUMN workspaces.owner_username     IS 'Projeyi oluşturan kullanıcının LDAP kullanıcı adı';
COMMENT ON COLUMN workspaces.default_timeout_ms IS 'Projenin varsayılan adım bekleme süresi (ms); boşsa uygulama varsayılanı';

CREATE INDEX ix_workspaces_owner_personal ON workspaces (owner_username) WHERE personal;

-- -----------------------------------------------------------------------------
-- Proje üyeleri
-- -----------------------------------------------------------------------------
CREATE TABLE workspace_members (
    id            varchar(36)   NOT NULL,
    workspace_id  varchar(36)   NOT NULL,
    username      varchar(255)  NOT NULL,
    added_by      varchar(255)  NOT NULL,
    created_at    timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT pk_workspace_members PRIMARY KEY (id),
    CONSTRAINT uq_workspace_members_workspace_username UNIQUE (workspace_id, username),
    CONSTRAINT fk_workspace_members_workspace FOREIGN KEY (workspace_id)
        REFERENCES workspaces (id) ON DELETE CASCADE
);
COMMENT ON TABLE workspace_members IS 'Projelere erişimi olan kullanıcılar (LDAP kullanıcı adı ile)';

CREATE INDEX ix_workspace_members_username ON workspace_members (username);

-- -----------------------------------------------------------------------------
-- Klasörler
-- -----------------------------------------------------------------------------
CREATE TABLE folders (
    id            varchar(36)   NOT NULL,
    name          varchar(255)  NOT NULL,
    workspace_id  varchar(36)   NOT NULL,
    created_at    timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT pk_folders PRIMARY KEY (id),
    CONSTRAINT fk_folders_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);
COMMENT ON TABLE folders IS 'Senaryoları gruplamak için klasörler';

CREATE INDEX ix_folders_workspace ON folders (workspace_id, name);

-- -----------------------------------------------------------------------------
-- Ortamlar (test, UAT, ön-canlı …)
-- -----------------------------------------------------------------------------
CREATE TABLE environments (
    id                  varchar(36)    NOT NULL,
    name                varchar(255)   NOT NULL,
    base_url            varchar(2048)  NOT NULL,
    workspace_id        varchar(36)    NOT NULL,
    default_timeout_ms  integer,
    created_at          timestamptz    NOT NULL DEFAULT now(),
    CONSTRAINT pk_environments PRIMARY KEY (id),
    CONSTRAINT fk_environments_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);
COMMENT ON TABLE  environments IS 'Senaryoların koşulabileceği ortamlar; koşumda senaryo adresinin kökü bu adresle değiştirilir';
COMMENT ON COLUMN environments.base_url IS 'Ortamın kök adresi (örn. https://uat.ornek.com.tr)';

CREATE INDEX ix_environments_workspace ON environments (workspace_id, name);

-- -----------------------------------------------------------------------------
-- Test veri setleri
-- -----------------------------------------------------------------------------
CREATE TABLE test_data_sets (
    id            varchar(36)   NOT NULL,
    name          varchar(255)  NOT NULL,
    workspace_id  varchar(36)   NOT NULL,
    entries       text          NOT NULL DEFAULT '[]',
    created_at    timestamptz   NOT NULL DEFAULT now(),
    updated_at    timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT pk_test_data_sets PRIMARY KEY (id),
    CONSTRAINT fk_test_data_sets_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);
COMMENT ON TABLE  test_data_sets IS 'Senaryo adımlarının değerlerini aldığı veri setleri';
COMMENT ON COLUMN test_data_sets.entries IS 'JSON dizi: [{key, type (text|file), value, sensitive, fileName}]. Dosyalar data: URL olarak tutulur. DİKKAT: gizli değerler içerebilir';

CREATE INDEX ix_test_data_sets_workspace ON test_data_sets (workspace_id, name);

-- -----------------------------------------------------------------------------
-- Senaryolar
-- -----------------------------------------------------------------------------
CREATE TABLE scenarios (
    id                 varchar(36)    NOT NULL,
    name               varchar(255)   NOT NULL,
    start_url          varchar(2048)  NOT NULL DEFAULT '',
    workspace_id       varchar(36)    NOT NULL,
    folder_id          varchar(36),
    tags               text,
    precondition_text  text,
    precondition_ids   text,
    timeout_ms         integer,
    created_at         timestamptz    NOT NULL DEFAULT now(),
    updated_at         timestamptz    NOT NULL DEFAULT now(),
    CONSTRAINT pk_scenarios PRIMARY KEY (id),
    CONSTRAINT fk_scenarios_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);
COMMENT ON TABLE  scenarios IS 'Test senaryoları';
COMMENT ON COLUMN scenarios.start_url        IS 'Başlangıç adresi. Önkoşulu olan senaryoda boş metin olabilir: koşum önkoşulun bittiği sayfadan devam eder';
COMMENT ON COLUMN scenarios.folder_id        IS 'Klasör (folders.id). Yabancı anahtar yok: klasör silinince senaryolar yerinde kalır';
COMMENT ON COLUMN scenarios.precondition_text IS 'Serbest metin ön koşul açıklaması';
COMMENT ON COLUMN scenarios.precondition_ids  IS 'Önce koşulacak senaryoların id''leri, sıralı, virgülle ayrılmış';
COMMENT ON COLUMN scenarios.timeout_ms        IS 'Senaryo bazında adım bekleme süresi (ms)';

CREATE INDEX ix_scenarios_workspace_updated ON scenarios (workspace_id, updated_at DESC);
CREATE INDEX ix_scenarios_folder            ON scenarios (folder_id) WHERE folder_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Senaryo adımları
-- -----------------------------------------------------------------------------
CREATE TABLE steps (
    id            varchar(36)   NOT NULL,
    scenario_id   varchar(36)   NOT NULL,
    order_index   integer       NOT NULL,
    action        varchar(255)  NOT NULL,
    candidates    text,
    step_value    text,
    data_binding  text,
    sensitive     boolean       NOT NULL DEFAULT false,
    meta          text,
    CONSTRAINT pk_steps PRIMARY KEY (id),
    CONSTRAINT fk_steps_scenario FOREIGN KEY (scenario_id)
        REFERENCES scenarios (id) ON DELETE CASCADE
);
COMMENT ON TABLE  steps IS 'Senaryo adımları; senaryo silinince adımları da silinir';
COMMENT ON COLUMN steps.action       IS 'goto, click, fill, select, upload, press, assert-text, assert-visible, wait, fill-form, script, repeat-start, repeat-end';
COMMENT ON COLUMN steps.candidates   IS 'JSON dizi: locator adayları [{strategy, value, score}]';
COMMENT ON COLUMN steps.step_value   IS 'Adımın değeri (yazılacak metin, adres, script …). Gizli adımlarda boş tutulur';
COMMENT ON COLUMN steps.data_binding IS 'JSON: {"dataSetKey": "..."} — değerin alınacağı veri seti anahtarı';
COMMENT ON COLUMN steps.meta         IS 'JSON: açıklama, etiket, bekleme süresi, opsiyonel, form/tekrar ayarları vb.';

CREATE INDEX ix_steps_scenario_order ON steps (scenario_id, order_index);

-- -----------------------------------------------------------------------------
-- Koşumlar
-- -----------------------------------------------------------------------------
CREATE TABLE runs (
    id                varchar(36)   NOT NULL,
    scenario_id       varchar(36)   NOT NULL,
    workspace_id      varchar(36)   NOT NULL,
    environment_id    varchar(36),
    test_data_set_id  varchar(36),
    status            varchar(255)  NOT NULL DEFAULT 'queued',
    triggered_by      varchar(255)  NOT NULL,
    started_at        timestamptz,
    finished_at       timestamptz,
    created_at        timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT pk_runs PRIMARY KEY (id),
    CONSTRAINT fk_runs_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);
COMMENT ON TABLE  runs IS 'Senaryo koşumları (geçmiş). Senaryo/ortam/veri seti silinse de koşum geçmişi korunur';
COMMENT ON COLUMN runs.scenario_id      IS 'Koşulan senaryo (scenarios.id). Yabancı anahtar yok: geçmiş korunur';
COMMENT ON COLUMN runs.environment_id   IS 'Kullanılan ortam (environments.id), yabancı anahtar yok';
COMMENT ON COLUMN runs.test_data_set_id IS 'Kullanılan veri seti (test_data_sets.id), yabancı anahtar yok';
COMMENT ON COLUMN runs.status           IS 'queued, running, passed, failed, blocked …';
COMMENT ON COLUMN runs.triggered_by     IS 'Koşumu başlatan kullanıcının LDAP kullanıcı adı';

CREATE INDEX ix_runs_workspace_created          ON runs (workspace_id, created_at DESC);
CREATE INDEX ix_runs_workspace_scenario_created ON runs (workspace_id, scenario_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Koşum adım sonuçları
-- -----------------------------------------------------------------------------
CREATE TABLE run_step_results (
    id               varchar(36)   NOT NULL,
    run_id           varchar(36)   NOT NULL,
    step_id          varchar(36),
    order_index      integer       NOT NULL,
    status           varchar(255)  NOT NULL,
    healed           boolean       NOT NULL DEFAULT false,
    healed_strategy  varchar(255),
    error_message    text,
    step_snapshot    text,
    started_at       timestamptz,
    located_at       timestamptz,
    finished_at      timestamptz,
    screenshot       text,
    CONSTRAINT pk_run_step_results PRIMARY KEY (id),
    CONSTRAINT fk_run_step_results_run FOREIGN KEY (run_id)
        REFERENCES runs (id) ON DELETE CASCADE
);
COMMENT ON TABLE  run_step_results IS 'Koşumdaki her adımın sonucu; koşum silinince sonuçları da silinir';
COMMENT ON COLUMN run_step_results.step_id         IS 'Adım (steps.id). Yabancı anahtar yok: adım/senaryo silinse de sonuç korunur';
COMMENT ON COLUMN run_step_results.healed          IS 'Adım yedek bir locator ile bulunduysa true';
COMMENT ON COLUMN run_step_results.healed_strategy IS 'Kullanılan yedek locator stratejisi (css, text …)';
COMMENT ON COLUMN run_step_results.error_message   IS 'Hata mesajı; geçen adımlarda "Not: …" ile başlayan bilgi notu';
COMMENT ON COLUMN run_step_results.step_snapshot   IS 'JSON: adımın koşulduğu andaki tanımı (gizli/bağlı değerler yazılmaz)';
COMMENT ON COLUMN run_step_results.screenshot      IS 'Ekran görüntüsü (data: URL, base64). Verinin büyük kısmı bu kolondadır';

CREATE INDEX ix_run_step_results_run_order ON run_step_results (run_id, order_index);
CREATE INDEX ix_run_step_results_step      ON run_step_results (step_id) WHERE step_id IS NOT NULL;
