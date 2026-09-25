package com.testflow.web.repository;

import com.testflow.web.entity.Run;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;

import java.util.List;
import java.util.Optional;

public interface RunRepository extends JpaRepository<Run, String> {
    List<Run> findByWorkspaceIdOrderByCreatedAtDesc(String workspaceId);
    List<Run> findByWorkspaceIdAndScenarioIdOrderByCreatedAtDesc(String workspaceId, String scenarioId);
    Optional<Run> findByIdAndWorkspaceId(String id, String workspaceId);

    /** [stepId, startedAt, locatedAt] — yalnız zaman alanları (ekran görüntüleri yüklenmez). */
    @Query("select r.stepId, r.startedAt, r.locatedAt from RunStepResult r " +
           "where r.run.workspaceId = :ws and r.run.scenarioId = :sid " +
           "and r.stepId is not null and r.startedAt is not null and r.locatedAt is not null " +
           "and r.run.createdAt >= :since")
    List<Object[]> findStepWaits(@Param("ws") String workspaceId, @Param("sid") String scenarioId,
                                 @Param("since") Instant since);
}
