package com.testflow.web.dto;

import java.time.Instant;
import java.util.List;

/**
 * Dışa/içe aktarma dosyasının biçimi (JSON).
 *
 * Kimlikler (id) yalnız dosya içindeki referansları (klasör, önkoşul, adım, ortam,
 * veri seti) eşlemek için taşınır; içe aktarmada her kayıt yeni kimlikle oluşturulur.
 * Biçim değişirse VERSION artırılır; daha yeni sürümlü dosyalar reddedilir.
 */
public final class TransferDtos {

    private TransferDtos() {}

    public static final String FORMAT = "testflow-export";
    public static final int VERSION = 1;

    public record ExportFile(
            String format,
            Integer version,
            Instant exportedAt,
            String exportedBy,
            Boolean includesRuns,
            List<WorkspaceData> workspaces) {}

    public record WorkspaceData(
            String id,
            String name,
            Boolean personal,
            String ownerUsername,
            Integer defaultTimeoutMs,
            Instant createdAt,
            List<MemberData> members,
            List<FolderData> folders,
            List<EnvironmentData> environments,
            List<TestDataSetData> testDataSets,
            List<ScenarioData> scenarios,
            List<RunData> runs) {}

    public record MemberData(String username, String addedBy, Instant createdAt) {}

    public record FolderData(String id, String name, Instant createdAt) {}

    public record EnvironmentData(
            String id, String name, String baseUrl, Integer defaultTimeoutMs, Instant createdAt) {}

    public record TestDataSetData(
            String id, String name, String entries, Instant createdAt, Instant updatedAt) {}

    public record ScenarioData(
            String id,
            String name,
            String startUrl,
            String folderId,
            String tags,
            String preconditionText,
            String preconditionIds,
            Integer timeoutMs,
            Instant createdAt,
            Instant updatedAt,
            List<StepData> steps) {}

    public record StepData(
            String id,
            Integer orderIndex,
            String action,
            String candidates,
            String value,
            String dataBinding,
            Boolean sensitive,
            String meta) {}

    public record RunData(
            String id,
            String scenarioId,
            String environmentId,
            String testDataSetId,
            String status,
            String triggeredBy,
            Instant startedAt,
            Instant finishedAt,
            Instant createdAt,
            List<StepResultData> stepResults) {}

    public record StepResultData(
            String stepId,
            Integer orderIndex,
            String status,
            Boolean healed,
            String healedStrategy,
            String errorMessage,
            String stepSnapshot,
            Instant startedAt,
            Instant locatedAt,
            Instant finishedAt,
            String screenshot) {}

    /** İçe aktarma özeti. notes: kullanıcıya gösterilecek açıklamalar (yeniden adlandırma vb.). */
    public record ImportResult(
            int workspaces,
            int folders,
            int environments,
            int testDataSets,
            int scenarios,
            int steps,
            int runs,
            List<String> notes) {}
}
