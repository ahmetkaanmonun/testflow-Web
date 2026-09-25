package com.testflow.web.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

@Entity
@Table(name = "run_step_results")
@Getter @Setter @NoArgsConstructor
public class RunStepResult {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "run_id", nullable = false)
    private Run run;

    @Column(name = "step_id")
    private String stepId;

    @Column(nullable = false)
    private int orderIndex;

    /** passed | failed | skipped */
    @Column(nullable = false)
    private String status;

    @Column(nullable = false)
    private boolean healed = false;

    private String healedStrategy;

    @Column(columnDefinition = "TEXT")
    private String errorMessage;

    /**
     * Koşulan adımın o anki tanımının kopyası — JSON string
     * ({action, target, value, dataBindingKey, sensitive, meta}).
     * Senaryo sonradan değişse/silinse de geçmiş koşum okunabilir kalır.
     * Hassas veya veri setine bağlı adımlarda değer yazılmaz.
     */
    @Column(columnDefinition = "TEXT")
    private String stepSnapshot;

    /** Adım başladı. */
    private Instant startedAt;
    /** Element bulundu (locator beklemesi bitti); element gerektirmeyen adımlarda boş. */
    private Instant locatedAt;
    /** Sonuç raporlandı (click/press'te aksiyon anı). */
    private Instant finishedAt;

    /** Adım anındaki ekran görüntüsü — data URL (jpeg base64). */
    @Column(columnDefinition = "CLOB")
    private String screenshot;
}
