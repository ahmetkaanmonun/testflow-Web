package com.testflow.web.controller;

import com.testflow.web.dto.CommonDtos.*;
import com.testflow.web.entity.Run;
import com.testflow.web.entity.RunStepResult;
import com.testflow.web.repository.RunRepository;
import com.testflow.web.repository.ScenarioRepository;
import com.testflow.web.security.AuthenticatedUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/runs")
public class RunController {

    private final RunRepository runs;
    private final ScenarioRepository scenarios;

    public RunController(RunRepository runs, ScenarioRepository scenarios) {
        this.runs = runs;
        this.scenarios = scenarios;
    }

    @GetMapping
    public List<RunSummaryDto> list(@RequestParam(required = false) String scenarioId, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        List<Run> result = scenarioId != null
                ? runs.findByWorkspaceIdAndScenarioIdOrderByCreatedAtDesc(user.workspaceId(), scenarioId)
                : runs.findByWorkspaceIdOrderByCreatedAtDesc(user.workspaceId());
        return result.stream().map(r -> new RunSummaryDto(
                r.getId(), r.getScenarioId(), r.getEnvironmentId(), r.getTestDataSetId(),
                r.getStatus(), r.getTriggeredBy(), r.getStartedAt(), r.getFinishedAt(), r.getCreatedAt(),
                r.getStepResults().size(),
                (int) r.getStepResults().stream().filter(s -> "failed".equals(s.getStatus())).count(),
                (int) r.getStepResults().stream().filter(RunStepResult::isHealed).count()
        )).toList();
    }

    @GetMapping("/{id}")
    public RunDto get(@PathVariable String id, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Run run = runs.findByIdAndWorkspaceId(id, user.workspaceId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Koşum bulunamadı."));
        return toDto(run);
    }

    /** Tarayıcıda/lokalde koşulan testin sonucunu kaydeder. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public RunDto ingest(@Valid @RequestBody IngestRunRequest body, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);

        scenarios.findByIdAndWorkspaceId(body.scenarioId(), user.workspaceId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Senaryo bulunamadı."));

        Run run = new Run();
        run.setScenarioId(body.scenarioId());
        run.setWorkspaceId(user.workspaceId());
        run.setEnvironmentId(body.environmentId());
        run.setTestDataSetId(body.testDataSetId());
        run.setStatus(body.status());
        run.setTriggeredBy(user.username());
        run.setStartedAt(Instant.parse(body.startedAt()));
        run.setFinishedAt(Instant.parse(body.finishedAt()));

        if (body.stepResults() != null) {
            for (IngestStepResult r : body.stepResults()) {
                RunStepResult result = new RunStepResult();
                result.setRun(run);
                result.setStepId(r.stepId());
                result.setOrderIndex(r.orderIndex());
                result.setStatus(r.status());
                result.setHealed(r.healed());
                result.setHealedStrategy(r.healedStrategy());
                result.setErrorMessage(r.errorMessage());
                result.setScreenshot(r.screenshot());
                result.setStepSnapshot(r.stepSnapshot());
                result.setStartedAt(epoch(r.startedAt()));
                result.setLocatedAt(epoch(r.locatedAt()));
                result.setFinishedAt(epoch(r.finishedAt()));
                run.getStepResults().add(result);
            }
        }
        return toDto(runs.save(run));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        Run run = runs.findByIdAndWorkspaceId(id, user.workspaceId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Koşum bulunamadı."));
        runs.delete(run);
    }

    /** Bir senaryonun tüm koşum geçmişini siler (scenarioId zorunlu). */
    @DeleteMapping
    @Transactional
    public java.util.Map<String, Integer> deleteAll(@RequestParam String scenarioId, HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        List<Run> toDelete = runs.findByWorkspaceIdAndScenarioIdOrderByCreatedAtDesc(user.workspaceId(), scenarioId);
        runs.deleteAll(toDelete);
        return java.util.Map.of("deleted", toDelete.size());
    }

    private RunDto toDto(Run r) {
        return new RunDto(
                r.getId(), r.getScenarioId(), r.getEnvironmentId(), r.getTestDataSetId(),
                r.getStatus(), r.getTriggeredBy(), r.getStartedAt(), r.getFinishedAt(), r.getCreatedAt(),
                r.getStepResults().stream().map(s -> new RunStepResultDto(
                        s.getId(), s.getStepId(), s.getOrderIndex(), s.getStatus(),
                        s.isHealed(), s.getHealedStrategy(), s.getErrorMessage(), s.getScreenshot(),
                        s.getStepSnapshot(), s.getStartedAt(), s.getLocatedAt(), s.getFinishedAt())).toList());
    }

    private static Instant epoch(Long ms) {
        return ms == null ? null : Instant.ofEpochMilli(ms);
    }
}
