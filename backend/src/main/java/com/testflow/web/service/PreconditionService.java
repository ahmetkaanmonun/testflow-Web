package com.testflow.web.service;

import com.testflow.web.entity.Scenario;
import com.testflow.web.repository.ScenarioRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

/**
 * Önkoşul senaryoları: bir senaryo, kendisinden önce koşulacak başka
 * senaryolara (örn. "Login") sıralı referans verir. Referanslar aynı proje
 * içindedir; döngü yasaktır, zincir derinliği MAX_DEPTH ile sınırlıdır.
 */
@Service
public class PreconditionService {

    public static final int MAX_DEPTH = 3;

    private final ScenarioRepository scenarios;

    public PreconditionService(ScenarioRepository scenarios) {
        this.scenarios = scenarios;
    }

    public static List<String> parse(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    public static String join(List<String> ids) {
        return ids == null || ids.isEmpty() ? null : String.join(",", ids);
    }

    /** Kaydetmeden önce doğrular: aynı projede var, kendisi değil, döngü yok, derinlik ≤ MAX_DEPTH. */
    public List<String> validate(String workspaceId, String selfId, List<String> ids) {
        if (ids == null) return List.of();
        List<String> clean = new ArrayList<>(new LinkedHashSet<>(ids)); // tekrarları at, sırayı koru
        Map<String, Scenario> cache = new HashMap<>();
        for (String id : clean) {
            if (id.equals(selfId)) {
                throw bad("Senaryo kendisinin önkoşulu olamaz.");
            }
            Scenario pre = load(workspaceId, id, cache);
            if (pre == null) throw bad("Önkoşul senaryosu bulunamadı (silinmiş olabilir).");
            int depth = depthOf(workspaceId, pre, selfId, new ArrayDeque<>(), cache);
            if (depth > MAX_DEPTH) {
                throw bad("Önkoşul zinciri en fazla " + MAX_DEPTH + " seviye olabilir (\"" + pre.getName() + "\" çok derin).");
            }
        }
        return clean;
    }

    /** Zincirde selfId'ye geri dönülürse döngüdür; aksi halde seviye sayısını döner. */
    private int depthOf(String ws, Scenario s, String selfId, Deque<String> path, Map<String, Scenario> cache) {
        if (path.contains(s.getId())) throw bad("Önkoşullarda döngü var (\"" + s.getName() + "\").");
        path.push(s.getId());
        int max = 0;
        for (String childId : parse(s.getPreconditionIds())) {
            if (childId.equals(selfId)) {
                throw bad("Döngü oluşur: \"" + s.getName() + "\" zaten bu senaryoyu önkoşul olarak kullanıyor.");
            }
            Scenario child = load(ws, childId, cache);
            if (child != null) max = Math.max(max, depthOf(ws, child, selfId, path, cache));
        }
        path.pop();
        return 1 + max;
    }

    /**
     * Koşum sırası: her kökün önkoşulları önce (derinlik öncelikli), her senaryo
     * zincirde bir kez. Örn. A→[Login], B→[Login] ve kökler [A, B] ise: Login, A, B.
     */
    public List<Scenario> chain(String workspaceId, List<String> rootIds) {
        List<Scenario> out = new ArrayList<>();
        Set<String> added = new HashSet<>();
        Map<String, Scenario> cache = new HashMap<>();
        for (String id : rootIds) visit(workspaceId, id, out, added, new HashSet<>(), cache, 1);
        return out;
    }

    private void visit(String ws, String id, List<Scenario> out, Set<String> added, Set<String> path,
                       Map<String, Scenario> cache, int level) {
        if (added.contains(id)) return;
        if (!path.add(id) || level > MAX_DEPTH + 1) throw bad("Önkoşullarda döngü veya çok derin zincir var.");
        Scenario s = load(ws, id, cache);
        if (s == null) throw bad("Önkoşul senaryosu bulunamadı (silinmiş olabilir).");
        for (String child : parse(s.getPreconditionIds())) visit(ws, child, out, added, path, cache, level + 1);
        path.remove(id);
        added.add(id);
        out.add(s);
    }

    /** Bu senaryoyu önkoşul olarak kullanan senaryolar. */
    public List<Scenario> dependentsOf(String workspaceId, String id) {
        return scenarios.findByWorkspaceIdOrderByUpdatedAtDesc(workspaceId).stream()
                .filter(s -> parse(s.getPreconditionIds()).contains(id))
                .toList();
    }

    private Scenario load(String ws, String id, Map<String, Scenario> cache) {
        return cache.computeIfAbsent(id, k -> scenarios.findByIdAndWorkspaceId(k, ws).orElse(null));
    }

    private static ResponseStatusException bad(String msg) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
    }
}
