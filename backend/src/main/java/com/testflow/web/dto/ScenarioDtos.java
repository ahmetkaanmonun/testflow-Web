package com.testflow.web.dto;

import jakarta.validation.constraints.NotBlank;

import java.time.Instant;
import java.util.List;

public class ScenarioDtos {

    public record StepDto(
            String id,
            int orderIndex,
            String action,
            String candidates,
            String value,
            String dataBinding,
            boolean sensitive,
            String meta) {}

    public record ScenarioSummary(
            String id, String name, String startUrl, String folderId,
            String tags, int stepCount, Instant createdAt, Instant updatedAt,
            List<String> preconditionIds) {}

    public record ScenarioDetail(
            String id, String name, String startUrl, String folderId,
            String tags, List<StepDto> steps, Instant createdAt, Instant updatedAt,
            Integer timeoutMs, String preconditionText, List<String> preconditionIds) {}

    public record CreateScenarioRequest(
            @NotBlank String name,
            @NotBlank String startUrl,
            String folderId,
            String tags,
            List<StepDto> steps) {}

    /**
     * null alanlar değişmez. timeoutMs 0 → temizlenir; preconditionIds boş liste → temizlenir;
     * preconditionText "" → temizlenir.
     */
    public record UpdateScenarioRequest(
            String name, String startUrl, String folderId, String tags, List<StepDto> steps,
            Integer timeoutMs, String preconditionText, List<String> preconditionIds) {}
}
