package com.testflow.web.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "scenarios")
@Getter @Setter @NoArgsConstructor
public class Scenario {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String startUrl;

    @Column(name = "workspace_id", nullable = false)
    private String workspaceId;

    @Column(name = "folder_id")
    private String folderId;

    /** Virgülle ayrılmış etiketler (H2 için basit tutuldu). */
    @Column(columnDefinition = "TEXT")
    private String tags;

    /** Açıklayıcı önkoşul metni (örn. "Kullanıcının onay yetkisi olmalı"). */
    @Column(columnDefinition = "TEXT")
    private String preconditionText;

    /** Önce koşulacak senaryoların id'leri, sıralı ve virgülle ayrılmış (aynı proje). */
    @Column(columnDefinition = "TEXT")
    private String preconditionIds;

    /** Senaryo geneli locator bekleme süresi (ms); boşsa ortam/proje varsayılanı. */
    private Integer timeoutMs;

    @OneToMany(mappedBy = "scenario", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("orderIndex ASC")
    private List<Step> steps = new ArrayList<>();

    @Column(updatable = false, nullable = false)
    private Instant createdAt = Instant.now();

    @Column(nullable = false)
    private Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() { this.updatedAt = Instant.now(); }
}
