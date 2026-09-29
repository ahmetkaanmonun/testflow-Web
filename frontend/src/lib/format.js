// Tarih/süre biçimlendirme yardımcıları (koşum detayı için)

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 25.09.2026 14:32:07 */
export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 14:32:07.412 */
export function formatTimeMs(value) {
  if (!value) return '—';
  const d = new Date(value);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Koşum başına göre göreli zaman: +00:03.2 */
export function formatOffset(value, base) {
  if (!value || !base) return '';
  const ms = Math.max(0, new Date(value) - new Date(base));
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec - min * 60;
  return `+${pad(min)}:${sec.toFixed(1).padStart(4, '0')}`;
}

/** 850 ms / 3,2 sn / 1 dk 05 sn */
export function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1).replace('.', ',')} sn`;
  const min = Math.floor(ms / 60000);
  return `${min} dk ${pad(Math.round((ms % 60000) / 1000))} sn`;
}

export function diffMs(a, b) {
  if (!a || !b) return null;
  return new Date(b) - new Date(a);
}
