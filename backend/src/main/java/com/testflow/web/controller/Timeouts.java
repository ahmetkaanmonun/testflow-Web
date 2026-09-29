package com.testflow.web.controller;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Locator bekleme süresi doğrulaması. Öncelik zinciri koşumda uygulanır:
 * adım → senaryo → ortam → proje → sistem varsayılanı (5 sn).
 * API sözleşmesi: alan gönderilmezse (null) değişmez, 0 veya negatif gönderilirse
 * temizlenir (üst seviyeye düşülür), aksi halde 0,5–60 sn aralığında olmalı.
 */
final class Timeouts {
    static final int MIN_MS = 500;
    static final int MAX_MS = 60_000;

    private Timeouts() {}

    /** @return kaydedilecek değer (null = temizle); geçersizse 400 */
    static Integer normalize(Integer ms) {
        if (ms == null || ms <= 0) return null;
        if (ms < MIN_MS || ms > MAX_MS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Bekleme süresi 0,5 ile 60 saniye arasında olmalı.");
        }
        return ms;
    }
}
