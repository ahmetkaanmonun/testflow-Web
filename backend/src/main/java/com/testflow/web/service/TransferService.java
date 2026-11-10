package com.testflow.web.service;

import com.testflow.web.dto.TransferDtos.EnvironmentData;
import com.testflow.web.dto.TransferDtos.ExportFile;
import com.testflow.web.dto.TransferDtos.FolderData;
import com.testflow.web.dto.TransferDtos.ImportResult;
import com.testflow.web.dto.TransferDtos.MemberData;
import com.testflow.web.dto.TransferDtos.RunData;
import com.testflow.web.dto.TransferDtos.ScenarioData;
import com.testflow.web.dto.TransferDtos.StepData;
import com.testflow.web.dto.TransferDtos.StepResultData;
import com.testflow.web.dto.TransferDtos.TestDataSetData;
import com.testflow.web.dto.TransferDtos.WorkspaceData;
import com.testflow.web.entity.Environment;
import com.testflow.web.entity.Folder;
import com.testflow.web.entity.Run;
import com.testflow.web.entity.RunStepResult;
import com.testflow.web.entity.Scenario;
import com.testflow.web.entity.Step;
import com.testflow.web.entity.TestDataSet;
import com.testflow.web.entity.Workspace;
import com.testflow.web.entity.WorkspaceMember;
import com.testflow.web.repository.EnvironmentRepository;
import com.testflow.web.repository.FolderRepository;
import com.testflow.web.repository.RunRepository;
import com.testflow.web.repository.ScenarioRepository;
import com.testflow.web.repository.TestDataSetRepository;
import com.testflow.web.repository.WorkspaceMemberRepository;
import com.testflow.web.repository.WorkspaceRepository;
import com.testflow.web.security.AuthenticatedUser;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.testflow.web.dto.TransferDtos.FORMAT;
import static com.testflow.web.dto.TransferDtos.VERSION;

/**
 * Projelerin tüm içeriğini tek bir JSON dosyasına aktarır ve geri yükler.
 * Kullanım: sunucuya taşıma, yedekleme, bir sistemden diğerine aktarım.
 *
 * İçe aktarmada her kayıt YENİ kimlikle oluşturulur (mevcut verinin üzerine yazılmaz,
 * dolu bir sisteme de aktarılabilir); dosya içi referanslar (klasör, önkoşul, adım,
 * ortam, veri seti) yeni kimliklere bağlanır. Tarihler korunur. Tek transaction:
 * hata olursa hiçbir şey kaydedilmez.
 */
@Service
public class TransferService {

    private final WorkspaceRepository workspaces;
    private final WorkspaceMemberRepository members;
    private final FolderRepository folders;
    private final EnvironmentRepository environments;
    private final TestDataSetRepository dataSets;
    private final ScenarioRepository scenarios;
    private final RunRepository runs;
    private final WorkspaceService workspaceService;

    public TransferService(WorkspaceRepository workspaces,
                           WorkspaceMemberRepository members,
                           FolderRepository folders,
                           EnvironmentRepository environments,
                           TestDataSetRepository dataSets,
                           ScenarioRepository scenarios,
                           RunRepository runs,
                           WorkspaceService workspaceService) {
        this.workspaces = workspaces;
        this.members = members;
        this.folders = folders;
        this.environments = environments;
        this.dataSets = dataSets;
        this.scenarios = scenarios;
        this.runs = runs;
        this.workspaceService = workspaceService;
    }

    // =========================================================================
    // Dışa aktarma
    // =========================================================================

    /**
     * @param allProjects true: kullanıcının üyesi olduğu tüm projeler; false: yalnız açık proje
     * @param includeRuns koşum geçmişi (ekran görüntüleriyle) dahil edilsin mi — dosyayı çok büyütür
     */
    @Transactional(readOnly = true)
    public ExportFile export(AuthenticatedUser user, boolean allProjects, boolean includeRuns) {
        List<Workspace> list = allProjects
                ? workspaceService.listFor(user.username())
                : List.of(workspaceService.assertMember(user.workspaceId(), user.username()));
        List<WorkspaceData> out = new ArrayList<>();
        for (Workspace ws : list) {
            out.add(exportWorkspace(ws, includeRuns));
        }
        return new ExportFile(FORMAT, VERSION, Instant.now(), user.username(), includeRuns, out);
    }

    private WorkspaceData exportWorkspace(Workspace ws, boolean includeRuns) {
        String id = ws.getId();

        List<MemberData> memberList = members.findByWorkspaceIdOrderByCreatedAtAsc(id).stream()
                .map(m -> new MemberData(m.getUsername(), m.getAddedBy(), m.getCreatedAt()))
                .toList();

        List<FolderData> folderList = folders.findByWorkspaceIdOrderByNameAsc(id).stream()
                .map(f -> new FolderData(f.getId(), f.getName(), f.getCreatedAt()))
                .toList();

        List<EnvironmentData> envList = environments.findByWorkspaceIdOrderByNameAsc(id).stream()
                .map(e -> new EnvironmentData(e.getId(), e.getName(), e.getBaseUrl(),
                        e.getDefaultTimeoutMs(), e.getCreatedAt()))
                .toList();

        List<TestDataSetData> dataSetList = dataSets.findByWorkspaceIdOrderByNameAsc(id).stream()
                .map(d -> new TestDataSetData(d.getId(), d.getName(), d.getEntries(),
                        d.getCreatedAt(), d.getUpdatedAt()))
                .toList();

        List<ScenarioData> scenarioList = scenarios.findByWorkspaceIdOrderByUpdatedAtDesc(id).stream()
                .map(this::exportScenario)
                .toList();

        List<RunData> runList = includeRuns
                ? runs.findByWorkspaceIdOrderByCreatedAtDesc(id).stream().map(this::exportRun).toList()
                : List.of();

        return new WorkspaceData(id, ws.getName(), ws.isPersonal(), ws.getOwnerUsername(),
                ws.getDefaultTimeoutMs(), ws.getCreatedAt(),
                memberList, folderList, envList, dataSetList, scenarioList, runList);
    }

    private ScenarioData exportScenario(Scenario s) {
        List<StepData> steps = s.getSteps().stream()
                .map(st -> new StepData(st.getId(), st.getOrderIndex(), st.getAction(),
                        st.getCandidates(), st.getValue(), st.getDataBinding(),
                        st.isSensitive(), st.getMeta()))
                .toList();
        return new ScenarioData(s.getId(), s.getName(), s.getStartUrl(), s.getFolderId(),
                s.getTags(), s.getPreconditionText(), s.getPreconditionIds(), s.getTimeoutMs(),
                s.getCreatedAt(), s.getUpdatedAt(), steps);
    }

    private RunData exportRun(Run r) {
        List<StepResultData> results = r.getStepResults().stream()
                .map(x -> new StepResultData(x.getStepId(), x.getOrderIndex(), x.getStatus(),
                        x.isHealed(), x.getHealedStrategy(), x.getErrorMessage(), x.getStepSnapshot(),
                        x.getStartedAt(), x.getLocatedAt(), x.getFinishedAt(), x.getScreenshot()))
                .toList();
        return new RunData(r.getId(), r.getScenarioId(), r.getEnvironmentId(), r.getTestDataSetId(),
                r.getStatus(), r.getTriggeredBy(), r.getStartedAt(), r.getFinishedAt(),
                r.getCreatedAt(), results);
    }

    // =========================================================================
    // İçe aktarma
    // =========================================================================

    /** İçe aktarma sırasında sayaçlar ve notlar. */
    private static final class Tally {
        int workspaces, folders, environments, dataSets, scenarios, steps, runs;
        final List<String> notes = new ArrayList<>();
    }

    @Transactional
    public ImportResult importFile(AuthenticatedUser user, ExportFile file) {
        if (file == null || !FORMAT.equals(file.format())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Bu dosya bir TestFlow dışa aktarma dosyası değil.");
        }
        if (file.version() == null || file.version() > VERSION) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Dosya sürümü (" + file.version() + ") bu TestFlow sürümünde desteklenmiyor. "
                            + "Önce TestFlow'u güncelleyin.");
        }

        Tally tally = new Tally();
        Set<String> usedNames = new HashSet<>();
        for (Workspace w : workspaceService.listFor(user.username())) {
            usedNames.add(w.getName());
        }

        for (WorkspaceData w : nz(file.workspaces())) {
            Workspace target = Boolean.TRUE.equals(w.personal())
                    ? personalTarget(user, w, tally)
                    : createSharedWorkspace(user, w, usedNames, tally);
            tally.workspaces++;
            importContents(target.getId(), user.username(), w, tally);
        }

        return new ImportResult(tally.workspaces, tally.folders, tally.environments, tally.dataSets,
                tally.scenarios, tally.steps, tally.runs, tally.notes);
    }

    /** Kişisel alan → içe aktaran kullanıcının kişisel alanı (mevcut içeriğin yanına eklenir). */
    private Workspace personalTarget(AuthenticatedUser user, WorkspaceData w, Tally tally) {
        Workspace target = workspaceService.getOrCreatePersonal(user.username(), user.displayName());
        if (target.getDefaultTimeoutMs() == null && w.defaultTimeoutMs() != null) {
            target.setDefaultTimeoutMs(w.defaultTimeoutMs());
            target = workspaces.save(target);
        }
        if (!isBlank(w.ownerUsername()) && !w.ownerUsername().equals(user.username())) {
            tally.notes.add("'" + w.ownerUsername() + "' kullanıcısının kişisel alanındaki içerik, "
                    + "sizin kişisel alanınıza aktarıldı.");
        }
        return target;
    }

    /** Ortak proje → üyeleriyle birlikte yeni proje. İçe aktaran kullanıcı her zaman üye olur. */
    private Workspace createSharedWorkspace(AuthenticatedUser user, WorkspaceData w,
                                            Set<String> usedNames, Tally tally) {
        String baseName = isBlank(w.name()) ? "İçe aktarılan proje" : w.name();
        String name = uniqueName(baseName, usedNames);
        usedNames.add(name);
        if (!name.equals(baseName)) {
            tally.notes.add("'" + baseName + "' adında bir projeniz zaten olduğu için içe aktarılan proje '"
                    + name + "' adıyla oluşturuldu.");
        }

        String owner = isBlank(w.ownerUsername()) ? user.username() : w.ownerUsername();
        Workspace ws = new Workspace(name, owner, false);
        ws.setDefaultTimeoutMs(w.defaultTimeoutMs());
        if (w.createdAt() != null) ws.setCreatedAt(w.createdAt());
        ws = workspaces.save(ws);

        Set<String> added = new HashSet<>();
        for (MemberData m : nz(w.members())) {
            if (isBlank(m.username()) || !added.add(m.username())) continue;
            WorkspaceMember member = new WorkspaceMember(ws.getId(), m.username(),
                    isBlank(m.addedBy()) ? user.username() : m.addedBy());
            if (m.createdAt() != null) member.setCreatedAt(m.createdAt());
            members.save(member);
        }
        if (added.add(owner)) {
            members.save(new WorkspaceMember(ws.getId(), owner, user.username()));
        }
        if (added.add(user.username())) {
            members.save(new WorkspaceMember(ws.getId(), user.username(), user.username()));
        }
        return ws;
    }

    private void importContents(String workspaceId, String username, WorkspaceData w, Tally tally) {
        Map<String, String> folderMap = new HashMap<>();
        Map<String, String> envMap = new HashMap<>();
        Map<String, String> dataSetMap = new HashMap<>();
        Map<String, String> scenarioMap = new HashMap<>();
        Map<String, String> stepMap = new HashMap<>();

        for (FolderData f : nz(w.folders())) {
            Folder n = new Folder();
            n.setName(f.name());
            n.setWorkspaceId(workspaceId);
            if (f.createdAt() != null) n.setCreatedAt(f.createdAt());
            putIfId(folderMap, f.id(), folders.save(n).getId());
            tally.folders++;
        }

        for (EnvironmentData e : nz(w.environments())) {
            Environment n = new Environment();
            n.setName(e.name());
            n.setBaseUrl(e.baseUrl());
            n.setWorkspaceId(workspaceId);
            n.setDefaultTimeoutMs(e.defaultTimeoutMs());
            if (e.createdAt() != null) n.setCreatedAt(e.createdAt());
            putIfId(envMap, e.id(), environments.save(n).getId());
            tally.environments++;
        }

        for (TestDataSetData d : nz(w.testDataSets())) {
            TestDataSet n = new TestDataSet();
            n.setName(d.name());
            n.setEntries(isBlank(d.entries()) ? "[]" : d.entries());
            n.setWorkspaceId(workspaceId);
            if (d.createdAt() != null) n.setCreatedAt(d.createdAt());
            if (d.updatedAt() != null) n.setUpdatedAt(d.updatedAt());
            putIfId(dataSetMap, d.id(), dataSets.save(n).getId());
            tally.dataSets++;
        }

        // Senaryolar: önkoşullar kendilerinden önce oluşturulur ki referanslar ilk kayıtta
        // yeni kimliklerle yazılsın (sonradan güncelleme updatedAt'i bozardı).
        Map<String, ScenarioData> byId = new LinkedHashMap<>();
        List<ScenarioData> withoutId = new ArrayList<>();
        for (ScenarioData s : nz(w.scenarios())) {
            if (isBlank(s.id())) withoutId.add(s);
            else byId.put(s.id(), s);
        }
        Set<String> visiting = new HashSet<>();
        for (ScenarioData s : byId.values()) {
            importScenario(s, workspaceId, byId, visiting, folderMap, scenarioMap, stepMap, tally);
        }
        for (ScenarioData s : withoutId) {
            createScenario(s, workspaceId, List.of(), folderMap, stepMap, tally);
        }

        for (RunData r : nz(w.runs())) {
            if (isBlank(r.scenarioId())) continue;
            Run n = new Run();
            // Dosyada olmayan (silinmiş) senaryo/ortam/veri seti: geçmişte olduğu gibi eski kimlik kalır
            n.setScenarioId(scenarioMap.getOrDefault(r.scenarioId(), r.scenarioId()));
            n.setWorkspaceId(workspaceId);
            n.setEnvironmentId(r.environmentId() == null ? null
                    : envMap.getOrDefault(r.environmentId(), r.environmentId()));
            n.setTestDataSetId(r.testDataSetId() == null ? null
                    : dataSetMap.getOrDefault(r.testDataSetId(), r.testDataSetId()));
            n.setStatus(isBlank(r.status()) ? "queued" : r.status());
            n.setTriggeredBy(isBlank(r.triggeredBy()) ? username : r.triggeredBy());
            n.setStartedAt(r.startedAt());
            n.setFinishedAt(r.finishedAt());
            if (r.createdAt() != null) n.setCreatedAt(r.createdAt());
            for (StepResultData sr : nz(r.stepResults())) {
                RunStepResult x = new RunStepResult();
                x.setRun(n);
                x.setStepId(sr.stepId() == null ? null : stepMap.getOrDefault(sr.stepId(), sr.stepId()));
                x.setOrderIndex(sr.orderIndex() == null ? 0 : sr.orderIndex());
                x.setStatus(isBlank(sr.status()) ? "skipped" : sr.status());
                x.setHealed(Boolean.TRUE.equals(sr.healed()));
                x.setHealedStrategy(sr.healedStrategy());
                x.setErrorMessage(sr.errorMessage());
                x.setStepSnapshot(sr.stepSnapshot());
                x.setStartedAt(sr.startedAt());
                x.setLocatedAt(sr.locatedAt());
                x.setFinishedAt(sr.finishedAt());
                x.setScreenshot(sr.screenshot());
                n.getStepResults().add(x);
            }
            runs.save(n);
            tally.runs++;
        }
    }

    /** Önkoşulları önce (derinlik öncelikli) içe aktarır; döngüye karşı korumalı. */
    private void importScenario(ScenarioData s, String workspaceId, Map<String, ScenarioData> byId,
                                Set<String> visiting, Map<String, String> folderMap,
                                Map<String, String> scenarioMap, Map<String, String> stepMap,
                                Tally tally) {
        if (scenarioMap.containsKey(s.id()) || !visiting.add(s.id())) return;

        List<String> mappedPreconditions = new ArrayList<>();
        for (String preId : PreconditionService.parse(s.preconditionIds())) {
            ScenarioData pre = byId.get(preId);
            if (pre == null) {
                tally.notes.add("'" + s.name() + "' senaryosunun bir önkoşulu dosyada bulunamadı "
                        + "(silinmiş olabilir); bu önkoşul aktarılmadı.");
                continue;
            }
            importScenario(pre, workspaceId, byId, visiting, folderMap, scenarioMap, stepMap, tally);
            String mapped = scenarioMap.get(preId);
            if (mapped != null) mappedPreconditions.add(mapped);
        }

        Scenario saved = createScenario(s, workspaceId, mappedPreconditions, folderMap, stepMap, tally);
        scenarioMap.put(s.id(), saved.getId());
    }

    private Scenario createScenario(ScenarioData s, String workspaceId, List<String> preconditionIds,
                                    Map<String, String> folderMap, Map<String, String> stepMap,
                                    Tally tally) {
        Scenario n = new Scenario();
        n.setName(isBlank(s.name()) ? "Adsız senaryo" : s.name());
        n.setStartUrl(s.startUrl() == null ? "" : s.startUrl());
        n.setWorkspaceId(workspaceId);
        n.setFolderId(s.folderId() == null ? null : folderMap.get(s.folderId()));
        n.setTags(s.tags());
        n.setPreconditionText(s.preconditionText());
        n.setPreconditionIds(PreconditionService.join(preconditionIds));
        n.setTimeoutMs(s.timeoutMs());
        if (s.createdAt() != null) n.setCreatedAt(s.createdAt());
        if (s.updatedAt() != null) n.setUpdatedAt(s.updatedAt());

        List<StepData> steps = new ArrayList<>(nz(s.steps()));
        steps.sort(Comparator.comparingInt(st -> st.orderIndex() == null ? 0 : st.orderIndex()));
        for (StepData st : steps) {
            Step x = new Step();
            x.setScenario(n);
            x.setOrderIndex(st.orderIndex() == null ? 0 : st.orderIndex());
            x.setAction(isBlank(st.action()) ? "click" : st.action());
            x.setCandidates(st.candidates());
            x.setValue(st.value());
            x.setDataBinding(st.dataBinding());
            x.setSensitive(Boolean.TRUE.equals(st.sensitive()));
            x.setMeta(st.meta());
            n.getSteps().add(x);
        }

        Scenario saved = scenarios.save(n);
        // Adımlar eklendiği sırayla kaydedilir; eski → yeni adım kimliği (koşum sonuçları için)
        List<Step> savedSteps = saved.getSteps();
        for (int i = 0; i < steps.size() && i < savedSteps.size(); i++) {
            putIfId(stepMap, steps.get(i).id(), savedSteps.get(i).getId());
        }
        tally.scenarios++;
        tally.steps += steps.size();
        return saved;
    }

    // =========================================================================
    // Yardımcılar
    // =========================================================================

    private static <T> List<T> nz(List<T> list) {
        return list == null ? List.of() : list;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static void putIfId(Map<String, String> map, String oldId, String newId) {
        if (!isBlank(oldId)) map.put(oldId, newId);
    }

    private static String uniqueName(String base, Set<String> used) {
        if (!used.contains(base)) return base;
        String candidate = base + " (içe aktarılan)";
        for (int n = 2; used.contains(candidate); n++) {
            candidate = base + " (içe aktarılan " + n + ")";
        }
        return candidate;
    }
}
