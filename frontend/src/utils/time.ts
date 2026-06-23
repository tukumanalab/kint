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
