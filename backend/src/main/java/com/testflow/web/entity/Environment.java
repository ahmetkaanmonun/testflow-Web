package com.testflow.web.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

@Entity
@Table(name = "environments")
@Getter @Setter @NoArgsConstructor
public class Environment {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String baseUrl;

    @Column(name = "workspace_id", nullable = false)
    private String workspaceId;

    /** Bu ortamda koşarken locator bekleme süresi (ms); boşsa proje varsayılanı. */
    private Integer defaultTimeoutMs;

    @Column(updatable = false, nullable = false)
    private Instant createdAt = Instant.now();
}
