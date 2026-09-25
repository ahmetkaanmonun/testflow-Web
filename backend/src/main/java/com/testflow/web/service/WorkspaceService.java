package com.testflow.web.service;

import com.testflow.web.entity.Workspace;
import com.testflow.web.entity.WorkspaceMember;
import com.testflow.web.repository.WorkspaceMemberRepository;
import com.testflow.web.repository.WorkspaceRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Service
public class WorkspaceService {

    private final WorkspaceRepository workspaces;
    private final WorkspaceMemberRepository members;

    public WorkspaceService(WorkspaceRepository workspaces, WorkspaceMemberRepository members) {
        this.workspaces = workspaces;
        this.members = members;
    }

    /** Kullanıcının Kişisel Alan'ını getirir; ilk girişte oluşturur. */
    @Transactional
    public Workspace getOrCreatePersonal(String username, String displayName) {
        return workspaces.findByOwnerUsernameAndPersonalTrue(username)
                .orElseGet(() -> {
                    Workspace ws = workspaces.save(
                            new Workspace("Kişisel Alan", username, true));
                    members.save(new WorkspaceMember(ws.getId(), username, username));
                    return ws;
                });
    }

    /** Kullanıcının üyesi olduğu tüm projeler. */
    public List<Workspace> listFor(String username) {
        return members.findByUsername(username).stream()
                .map(m -> workspaces.findById(m.getWorkspaceId()).orElse(null))
                .filter(w -> w != null)
                .toList();
    }

    @Transactional
    public Workspace create(String name, String ownerUsername) {
        Workspace ws = workspaces.save(new Workspace(name, ownerUsername, false));
        members.save(new WorkspaceMember(ws.getId(), ownerUsername, ownerUsername));
        return ws;
    }

    /** Üyelik doğrulaması — değilse 403. */
    public Workspace assertMember(String workspaceId, String username) {
        Workspace ws = workspaces.findById(workspaceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Proje bulunamadı."));
        if (!members.existsByWorkspaceIdAndUsername(workspaceId, username)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Bu projenin üyesi değilsiniz.");
        }
        return ws;
    }

    @Transactional
    public Workspace updateSettings(String workspaceId, Integer defaultTimeoutMs, boolean timeoutProvided) {
        Workspace ws = workspaces.findById(workspaceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Proje bulunamadı."));
        if (timeoutProvided) ws.setDefaultTimeoutMs(defaultTimeoutMs);
        return workspaces.save(ws);
    }

    public List<WorkspaceMember> membersOf(String workspaceId) {
        return members.findByWorkspaceIdOrderByCreatedAtAsc(workspaceId);
    }

    @Transactional
    public void addMember(String workspaceId, String username, String addedBy) {
        if (members.existsByWorkspaceIdAndUsername(workspaceId, username)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Kullanıcı zaten üye.");
        }
        members.save(new WorkspaceMember(workspaceId, username, addedBy));
    }

    @Transactional
    public void removeMember(String workspaceId, String username, Workspace ws) {
        if (username.equals(ws.getOwnerUsername())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Proje sahibi üyelikten çıkarılamaz.");
        }
        members.findByWorkspaceIdAndUsername(workspaceId, username)
                .ifPresent(members::delete);
    }
}
