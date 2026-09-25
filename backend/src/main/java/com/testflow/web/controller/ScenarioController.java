package com.testflow.web.controller;

import com.testflow.web.dto.ScenarioDtos.*;
import com.testflow.web.entity.Scenario;
import com.testflow.web.entity.Step;
import com.testflow.web.repository.ScenarioRepository;
import com.testflow.web.security.AuthenticatedUser;
import com.testflow.web.service.PreconditionService;
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
    private final PreconditionService preconditions;

    public ScenarioController(ScenarioRepository scenarios, WorkspaceService workspaceService,
                              PreconditionService preconditions) {
        this.scenarios = scenarios;
        this.workspaceService = workspaceService;
        this.preconditions = preconditions;
    }

    public record CopyRequest(String targetProjectId) {}

    /**
     * Senaryoyu (adımlarıyla) üyesi olunan başka bir projeye bağımsız kopya olarak taşır.
     * Başka projeye kopyalarken önkoşul senaryoları da (zinciriyle) kopyalanır ve
     * referanslar yeni kopyalara bağlanır; aynı projede çoğaltmada mevcut önkoşullar korunur.
     */
    @PostMapping("/{id}/copy")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ScenarioDetail copy(@PathVariable String id,
                               @RequestBody CopyRequest body,
                               HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Scenario src = find(id, user);
        workspaceService.assertMember(body.targetProjectId(), user.username());
        boolean sameProject = body.targetProjectId().equals(src.getWorkspaceId());
        return toDetail(copyScenario(src, body.targetProjectId(), sameProject, true, new java.util.HashMap<>()));
    }

    /** idMap: kaynak id → hedefteki kopya id (aynı önkoşul zincirde bir kez kopyalanır). */
    private Scenario copyScenario(Scenario src, String targetProjectId, boolean sameProject, boolean isRoot,
                                  java.util.Map<String, String> idMap) {
        List<String> preIds = PreconditionService.parse(src.getPreconditionIds());
        List<String> mappedPre = new java.util.ArrayList<>();
        if (sameProject) {
            mappedPre.addAll(preIds);
        } else {
            for (String preId : preIds) {
                String mapped = idMap.get(preId);
                if (mapped == null) {
                    Scenario pre = scenarios.findByIdAndWorkspaceId(preId, src.getWorkspaceId()).orElse(null);
                    if (pre == null) continue; // silinmiş referans — kopyaya taşınmaz
                    mapped = copyScenario(pre, targetProjectId, false, false, idMap).getId();
                }
                mappedPre.add(mapped);
            }
        }

        Scenario dst = new Scenario();
        // Aynı projeye çoğaltmada isim çakışmasın
        dst.setName(sameProject && isRoot ? src.getName() + " (kopya)" : src.getName());
        dst.setStartUrl(src.getStartUrl());
        dst.setTimeoutMs(src.getTimeoutMs());
        dst.setPreconditionText(src.getPreconditionText());
        dst.setPreconditionIds(PreconditionService.join(mappedPre));
        dst.setTags(src.getTags());
        dst.setWorkspaceId(targetProjectId);
        dst.setFolderId(sameProject ? src.getFolderId() : null); // klasörler projeye özgüdür
        for (Step st : src.getSteps()) {
            Step c = new Step();
            c.setScenario(dst);
            c.setOrderIndex(st.getOrderIndex());
            c.setAction(st.getAction());
            c.setCandidates(st.getCandidates());
            c.setValue(st.getValue());
            c.setDataBinding(st.getDataBinding());
            c.setSensitive(st.isSensitive());
            c.setMeta(st.getMeta());
            dst.getSteps().add(c);
        }
        Scenario saved = scenarios.save(dst);
        idMap.put(src.getId(), saved.getId());
        return saved;
    }

    /** Verilen kök senaryoların önkoşul zinciri, koşum sırasıyla (her senaryo bir kez). */
    @GetMapping("/precondition-chain")
    public List<ScenarioDetail> preconditionChain(@RequestParam(defaultValue = "") String ids, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        return preconditions.chain(user.workspaceId(), PreconditionService.parse(ids)).stream()
                .map(this::toDetail).toList();
    }

    @GetMapping
    public List<ScenarioSummary> list(HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        return scenarios.findByWorkspaceIdOrderByUpdatedAtDesc(user.workspaceId()).stream()
                .map(s -> new ScenarioSummary(
                        s.getId(), s.getName(), s.getStartUrl(), s.getFolderId(),
                        s.getTags(), s.getSteps().size(), s.getCreatedAt(), s.getUpdatedAt(),
                        PreconditionService.parse(s.getPreconditionIds())))
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
        if (body.timeoutMs() != null) s.setTimeoutMs(Timeouts.normalize(body.timeoutMs()));
        if (body.preconditionText() != null) {
            s.setPreconditionText(body.preconditionText().isBlank() ? null : body.preconditionText().trim());
        }
        if (body.preconditionIds() != null) {
            s.setPreconditionIds(PreconditionService.join(
                    preconditions.validate(user.workspaceId(), s.getId(), body.preconditionIds())));
        }
        return toDetail(scenarios.save(s));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@PathVariable String id, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Scenario s = find(id, user);
        List<Scenario> dependents = preconditions.dependentsOf(user.workspaceId(), id);
        if (!dependents.isEmpty()) {
            String names = String.join(", ", dependents.stream().map(d -> "\"" + d.getName() + "\"").toList());
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Bu senaryo şu senaryolarda önkoşul olarak kullanılıyor: " + names + ". Önce oradan kaldırın.");
        }
        scenarios.delete(s);
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
                s.getCreatedAt(), s.getUpdatedAt(), s.getTimeoutMs(),
                s.getPreconditionText(), PreconditionService.parse(s.getPreconditionIds()));
    }
}
