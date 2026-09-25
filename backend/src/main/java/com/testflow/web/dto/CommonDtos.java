package com.testflow.web.dto;

import jakarta.validation.constraints.NotBlank;

import java.time.Instant;
import java.util.List;

public class CommonDtos {

    // Folder
    public record FolderDto(String id, String name, Instant createdAt) {}
    public record CreateFolderRequest(@NotBlank String name) {}

    // Environment
    public record EnvironmentDto(String id, String name, String baseUrl, Instant createdAt) {}
    public record CreateEnvironmentRequest(@NotBlank String name, @NotBlank String baseUrl) {}

    // TestDataSet
    public record TestDataSetDto(String id, String name, String entries, Instant createdAt, Instant updatedAt) {}
    public record SaveTestDataSetRequest(@NotBlank String name, @NotBlank String entries) {}

    // Run
    public record RunStepResultDto(
            String id, String stepId, int orderIndex, String status,
            boolean healed, String healedStrategy, String errorMessage, String screenshot,
            String stepSnapshot, Instant startedAt, Instant locatedAt, Instant finishedAt) {}

    /** Liste/dashboard için hafif özet — stepResults (ve görüntüler) taşımaz. */
    public record RunSummaryDto(
            String id, String scenarioId, String environmentId, String testDataSetId,
            String status, String triggeredBy, Instant startedAt, Instant finishedAt,
            Instant createdAt, int totalSteps, int failedSteps, int healedSteps) {}

    public record RunDto(
            String id, String scenarioId, String environmentId, String testDataSetId,
            String status, String triggeredBy, Instant startedAt, Instant finishedAt,
            Instant createdAt, List<RunStepResultDto> stepResults) {}

    public record IngestRunRequest(
            @NotBlank String scenarioId,
            String environmentId,
            String testDataSetId,
            @NotBlank String status,
            @NotBlank String startedAt,
            @NotBlank String finishedAt,
            List<IngestStepResult> stepResults) {}

    public record IngestStepResult(
            int orderIndex, String stepId, String status,
            boolean healed, String healedStrategy, String errorMessage, String screenshot,
            String stepSnapshot,
            /* epoch ms — eklenti Date.now() gönderir */
            Long startedAt, Long locatedAt, Long finishedAt) {}
}
