/** Formats a duration in seconds to a compact "Xd Yh" or "Yh" string. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;

  if (days > 0) {
    return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
  }
  if (hours > 0) return `${hours}h`;
  if (totalMinutes > 0) return `${totalMinutes}m`;
  return '<1m';
}
