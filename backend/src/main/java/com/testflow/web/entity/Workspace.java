package com.testflow.web.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * Proje (eski adıyla workspace). AD grubu eşlemesi kaldırıldı:
 * kimlik doğrulama LDAP'ta, üyelik uygulamada (WorkspaceMember) yönetilir.
 */
@Entity
@Table(name = "workspaces")
@Getter @Setter @NoArgsConstructor
public class Workspace {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false)
    private String name;

    /** Projeyi oluşturan kullanıcı (AD kullanıcı adı). */
    @Column(nullable = false)
    private String ownerUsername;

    /** Kişisel Alan mı? Her kullanıcıya ilk girişte bir tane açılır. */
    @Column(nullable = false)
    private boolean personal = false;

    /** Proje geneli locator bekleme süresi (ms); boşsa sistem varsayılanı. */
    private Integer defaultTimeoutMs;

    @Column(updatable = false, nullable = false)
    private Instant createdAt = Instant.now();

    public Workspace(String name, String ownerUsername, boolean personal) {
        this.name = name;
        this.ownerUsername = ownerUsername;
        this.personal = personal;
    }
}
