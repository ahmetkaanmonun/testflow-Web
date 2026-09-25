package com.testflow.web.controller;

import com.testflow.web.dto.AuthDtos.LoginResponse;
import com.testflow.web.dto.AuthDtos.UserInfo;
import com.testflow.web.entity.Workspace;
import com.testflow.web.security.AuthenticatedUser;
import com.testflow.web.security.JwtService;
import com.testflow.web.service.LdapAuthService;
import com.testflow.web.service.WorkspaceService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {

    public record ProjectDto(String id, String name, boolean personal, String ownerUsername, boolean active,
                             Integer defaultTimeoutMs) {}
    /** defaultTimeoutMs 0 → temizlenir (sistem varsayılanı). */
    public record UpdateProjectRequest(Integer defaultTimeoutMs) {}
    public record CreateProjectRequest(@NotBlank String name) {}
    public record MemberDto(String username, String addedBy, Instant createdAt, boolean owner) {}
    public record AddMemberRequest(@NotBlank String username) {}

    private final WorkspaceService workspaceService;
    private final LdapAuthService ldapAuth;
    private final JwtService jwtService;

    public ProjectController(WorkspaceService workspaceService, LdapAuthService ldapAuth, JwtService jwtService) {
        this.workspaceService = workspaceService;
        this.ldapAuth = ldapAuth;
        this.jwtService = jwtService;
    }

    @GetMapping
    public List<ProjectDto> list(HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        return workspaceService.listFor(user.username()).stream()
                .map(w -> new ProjectDto(w.getId(), w.getName(), w.isPersonal(),
                        w.getOwnerUsername(), w.getId().equals(user.workspaceId()), w.getDefaultTimeoutMs()))
                .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectDto create(@Valid @RequestBody CreateProjectRequest body, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Workspace ws = workspaceService.create(body.name().trim(), user.username());
        return new ProjectDto(ws.getId(), ws.getName(), false, ws.getOwnerUsername(), false, null);
    }

    /** Proje ayarları — her üye güncelleyebilir. */
    @PatchMapping("/{id}")
    public ProjectDto update(@PathVariable String id, @RequestBody UpdateProjectRequest body, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        workspaceService.assertMember(id, user.username());
        Workspace ws = workspaceService.updateSettings(id,
                body.defaultTimeoutMs() == null ? null : Timeouts.normalize(body.defaultTimeoutMs()),
                body.defaultTimeoutMs() != null);
        return new ProjectDto(ws.getId(), ws.getName(), ws.isPersonal(), ws.getOwnerUsername(),
                ws.getId().equals(user.workspaceId()), ws.getDefaultTimeoutMs());
    }

    /** Aktif projeyi değiştirir — yeni JWT döner. */
    @PostMapping("/{id}/switch")
    public LoginResponse switchProject(@PathVariable String id, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Workspace ws = workspaceService.assertMember(id, user.username());
        String token = jwtService.generate(user.username(), user.displayName(), ws.getId(), ws.getName());
        return new LoginResponse(token,
                new UserInfo(user.username(), user.displayName(), ws.getId(), ws.getName()));
    }

    @GetMapping("/{id}/members")
    public List<MemberDto> members(@PathVariable String id, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Workspace ws = workspaceService.assertMember(id, user.username());
        return workspaceService.membersOf(id).stream()
                .map(m -> new MemberDto(m.getUsername(), m.getAddedBy(), m.getCreatedAt(),
                        m.getUsername().equals(ws.getOwnerUsername())))
                .toList();
    }

    @PostMapping("/{id}/members")
    @ResponseStatus(HttpStatus.CREATED)
    public MemberDto addMember(@PathVariable String id,
                               @Valid @RequestBody AddMemberRequest body,
                               HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Workspace ws = workspaceService.assertMember(id, user.username());
        if (ws.isPersonal()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Kişisel Alan'a üye eklenemez — bir proje oluşturun.");
        }
        String username = body.username().trim();
        if (ldapAuth.findUser(username) == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "Kullanıcı LDAP'ta bulunamadı: " + username);
        }
        workspaceService.addMember(id, username, user.username());
        return new MemberDto(username, user.username(), Instant.now(), false);
    }

    @DeleteMapping("/{id}/members/{username}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeMember(@PathVariable String id, @PathVariable String username, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Workspace ws = workspaceService.assertMember(id, user.username());
        if (!user.username().equals(ws.getOwnerUsername()) && !user.username().equals(username)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Yalnızca proje sahibi üye çıkarabilir (kendiniz ayrılabilirsiniz).");
        }
        workspaceService.removeMember(id, username, ws);
    }
}
