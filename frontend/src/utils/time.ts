/**
 * 勤務時間 (hours) を [h]:mm 形式の文字列に変換します。
 * @param hours 勤務時間 (単位: 時間)
 * @returns "[h]:mm" 形式の文字列。null/undefined の場合は '-' を返します。
 */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || isNaN(hours)) return '-';
  const totalMinutes = Math.round(hours * 60);
  const isNegative = totalMinutes < 0;
  const absMinutes = Math.abs(totalMinutes);
  const h = Math.floor(absMinutes / 60);
  const m = absMinutes % 60;
  return `${isNegative ? '-' : ''}${h}:${String(m).padStart(2, '0')}`;
}

/**
 * サーバーから返される naive UTC の ISO 文字列 (タイムゾーン指定なし) を
 * UTC として解釈した Date に変換します。
 * すでに 'Z' や '±HH:MM' が付与されている場合はそのまま解釈します。
 * @param timeStr ISO 8601 形式の日時文字列
 * @returns Date インスタンス
 */
export function parseUtcDate(timeStr: string): Date {
  const normalized =
    timeStr.includes('T') && !timeStr.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(timeStr)
      ? `${timeStr}Z`
      : timeStr;
  return new Date(normalized);
}

/**
 * naive UTC の ISO 日時文字列をローカルタイムの日時表記文字列に変換します。
 * @param iso ISO 8601 形式の日時文字列。null/undefined の場合は '-' を返します。
 * @returns ローカルタイムの日時文字列。変換に失敗した場合は '-' を返します。
 */
export function formatUtcDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return parseUtcDate(iso).toLocaleString('ja-JP');
  } catch {
    return '-';
  }
}
