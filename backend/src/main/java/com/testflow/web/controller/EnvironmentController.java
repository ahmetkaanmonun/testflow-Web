package com.testflow.web.controller;

import com.testflow.web.dto.CommonDtos.CreateEnvironmentRequest;
import com.testflow.web.dto.CommonDtos.EnvironmentDto;
import com.testflow.web.dto.CommonDtos.UpdateEnvironmentRequest;
import com.testflow.web.entity.Environment;
import com.testflow.web.repository.EnvironmentRepository;
import com.testflow.web.security.AuthenticatedUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/api/environments")
public class EnvironmentController {

    private final EnvironmentRepository environments;

    public EnvironmentController(EnvironmentRepository environments) {
        this.environments = environments;
    }

    @GetMapping
    public List<EnvironmentDto> list(HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        return environments.findByWorkspaceIdOrderByNameAsc(user.workspaceId()).stream()
                .map(EnvironmentController::toDto)
                .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public EnvironmentDto create(@Valid @RequestBody CreateEnvironmentRequest body, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Environment e = new Environment();
        e.setName(body.name());
        e.setBaseUrl(body.baseUrl());
        e.setWorkspaceId(user.workspaceId());
        e.setDefaultTimeoutMs(Timeouts.normalize(body.defaultTimeoutMs()));
        return toDto(environments.save(e));
    }

    @PatchMapping("/{id}")
    public EnvironmentDto update(@PathVariable String id, @RequestBody UpdateEnvironmentRequest body,
                                 HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Environment e = environments.findByIdAndWorkspaceId(id, user.workspaceId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Ortam bulunamadı."));
        if (body.name() != null && !body.name().isBlank()) e.setName(body.name().trim());
        if (body.baseUrl() != null && !body.baseUrl().isBlank()) e.setBaseUrl(body.baseUrl().trim());
        if (body.defaultTimeoutMs() != null) e.setDefaultTimeoutMs(Timeouts.normalize(body.defaultTimeoutMs()));
        return toDto(environments.save(e));
    }

    private static EnvironmentDto toDto(Environment e) {
        return new EnvironmentDto(e.getId(), e.getName(), e.getBaseUrl(), e.getCreatedAt(), e.getDefaultTimeoutMs());
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Environment e = environments.findByIdAndWorkspaceId(id, user.workspaceId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Ortam bulunamadı."));
        environments.delete(e);
    }
}
