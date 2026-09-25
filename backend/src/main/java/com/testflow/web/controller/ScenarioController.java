package com.testflow.web.controller;

import com.testflow.web.dto.ScenarioDtos.*;
import com.testflow.web.entity.Scenario;
import com.testflow.web.entity.Step;
import com.testflow.web.repository.ScenarioRepository;
import com.testflow.web.security.AuthenticatedUser;
import com.testflow.web.service.WorkspaceService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/api/scenarios")
public class ScenarioController {

    private final ScenarioRepository scenarios;
    private final WorkspaceService workspaceService;

    public ScenarioController(ScenarioRepository scenarios, WorkspaceService workspaceService) {
        this.scenarios = scenarios;
        this.workspaceService = workspaceService;
    }

    public record CopyRequest(String targetProjectId) {}

    /** Senaryoyu (adımlarıyla) üyesi olunan başka bir projeye bağımsız kopya olarak taşır. */
    @PostMapping("/{id}/copy")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ScenarioDetail copy(@PathVariable String id,
                               @RequestBody CopyRequest body,
                               HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Scenario src = find(id, user);
        workspaceService.assertMember(body.targetProjectId(), user.username());

        Scenario dst = new Scenario();
        // Aynı projeye çoğaltmada isim çakışmasın
        boolean sameProject = body.targetProjectId().equals(src.getWorkspaceId());
        dst.setName(sameProject ? src.getName() + " (kopya)" : src.getName());
        dst.setStartUrl(src.getStartUrl());
        dst.setTags(src.getTags());
        dst.setWorkspaceId(body.targetProjectId());
        dst.setFolderId(sameProject ? src.getFolderId() : null); // klasörler projeye özgüdür
        for (Step s : src.getSteps()) {
            Step copy = new Step();
            copy.setScenario(dst);
            copy.setOrderIndex(s.getOrderIndex());
            copy.setAction(s.getAction());
            copy.setCandidates(s.getCandidates());
            copy.setValue(s.getValue());
            copy.setDataBinding(s.getDataBinding());
            copy.setSensitive(s.isSensitive());
            copy.setMeta(s.getMeta());
            dst.getSteps().add(copy);
        }
        return toDetail(scenarios.save(dst));
    }

    @GetMapping
    public List<ScenarioSummary> list(HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        return scenarios.findByWorkspaceIdOrderByUpdatedAtDesc(user.workspaceId()).stream()
                .map(s -> new ScenarioSummary(
                        s.getId(), s.getName(), s.getStartUrl(), s.getFolderId(),
                        s.getTags(), s.getSteps().size(), s.getCreatedAt(), s.getUpdatedAt()))
                .toList();
    }

    @GetMapping("/{id}")
    public ScenarioDetail get(@PathVariable String id, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Scenario s = find(id, user);
        return toDetail(s);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ScenarioDetail create(@Valid @RequestBody CreateScenarioRequest body, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Scenario s = new Scenario();
        s.setName(body.name());
        s.setStartUrl(body.startUrl());
        s.setFolderId(body.folderId());
        s.setTags(body.tags());
        s.setWorkspaceId(user.workspaceId());
        applySteps(s, body.steps());
        return toDetail(scenarios.save(s));
    }

    @PatchMapping("/{id}")
    @Transactional
    public ScenarioDetail update(@PathVariable String id,
                                 @RequestBody UpdateScenarioRequest body,
                                 HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Scenario s = find(id, user);
        if (body.name() != null) s.setName(body.name());
        if (body.startUrl() != null) s.setStartUrl(body.startUrl());
        if (body.folderId() != null) s.setFolderId(body.folderId());
        if (body.tags() != null) s.setTags(body.tags());
        if (body.steps() != null) applySteps(s, body.steps());
        return toDetail(scenarios.save(s));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@PathVariable String id, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        scenarios.delete(find(id, user));
    }

    private Scenario find(String id, AuthenticatedUser user) {
        return scenarios.findByIdAndWorkspaceId(id, user.workspaceId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Senaryo bulunamadı."));
    }

    /**
     * Adım listesini id'ye göre senkronize eder: id'si eşleşen adım yerinde güncellenir
     * (UUID korunur), id'siz adım yeni oluşturulur, listede olmayan adım silinir.
     * Adım kimliğinin korunması koşum geçmişinin (RunStepResult.stepId) doğru adıma
     * bağlı kalması için şarttır — önceden her kaydetmede tüm adımlar yeni id alıyordu.
     */
    private void applySteps(Scenario s, List<StepDto> stepDtos) {
        java.util.Map<String, Step> existing = new java.util.HashMap<>();
        for (Step st : s.getSteps()) existing.put(st.getId(), st);

        List<Step> next = new java.util.ArrayList<>();
        if (stepDtos != null) {
            for (StepDto dto : stepDtos) {
                Step step = dto.id() != null ? existing.remove(dto.id()) : null;
                if (step == null) {
                    step = new Step();
                    step.setScenario(s);
                }
                step.setOrderIndex(dto.orderIndex());
                step.setAction(dto.action());
                step.setCandidates(dto.candidates());
                step.setValue(dto.value());
                step.setDataBinding(dto.dataBinding());
                step.setSensitive(dto.sensitive());
                step.setMeta(dto.meta());
                next.add(step);
            }
        }
        // existing'de kalanlar artık listede yok → orphanRemoval ile silinir
        s.getSteps().clear();
        s.getSteps().addAll(next);
    }

    private ScenarioDetail toDetail(Scenario s) {
        return new ScenarioDetail(
                s.getId(), s.getName(), s.getStartUrl(), s.getFolderId(), s.getTags(),
                s.getSteps().stream().map(st -> new StepDto(
                        st.getId(), st.getOrderIndex(), st.getAction(), st.getCandidates(),
                        st.getValue(), st.getDataBinding(), st.isSensitive(), st.getMeta())).toList(),
                s.getCreatedAt(), s.getUpdatedAt());
    }
}
