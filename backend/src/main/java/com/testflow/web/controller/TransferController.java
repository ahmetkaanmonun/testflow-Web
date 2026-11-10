package com.testflow.web.controller;

import com.testflow.web.dto.TransferDtos.ExportFile;
import com.testflow.web.dto.TransferDtos.ImportResult;
import com.testflow.web.security.AuthenticatedUser;
import com.testflow.web.service.TransferService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

/**
 * Projelerin dışa/içe aktarılması (taşıma, yedekleme).
 *
 * GET  /api/transfer/export?scope=all|current&includeRuns=false
 * POST /api/transfer/import   (gövde: dışa aktarma dosyası)
 *
 * Yalnız kullanıcının üyesi olduğu projeler dışa aktarılır. Dosya test veri
 * setlerindeki gizli değerleri (şifreler) içerir; arayüz kullanıcıyı uyarır.
 */
@RestController
@RequestMapping("/api/transfer")
public class TransferController {

    private final TransferService transfer;

    public TransferController(TransferService transfer) {
        this.transfer = transfer;
    }

    @GetMapping("/export")
    public ResponseEntity<ExportFile> export(@RequestParam(defaultValue = "all") String scope,
                                             @RequestParam(defaultValue = "false") boolean includeRuns,
                                             HttpServletRequest req) {
        AuthenticatedUser user = CurrentUser.from(req);
        ExportFile file = transfer.export(user, !"current".equals(scope), includeRuns);
        String fileName = "testflow-aktarim-" + LocalDate.now() + ".json";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fileName + "\"")
                .body(file);
    }

    @PostMapping("/import")
    public ImportResult importFile(@RequestBody ExportFile file, HttpServletRequest req) {
        return transfer.importFile(CurrentUser.from(req), file);
    }
}
