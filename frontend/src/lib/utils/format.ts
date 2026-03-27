export function formatUptime(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2) + "%";
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function uptimeColor(basisPoints: number): string {
  if (basisPoints >= 9950) return "text-emerald-600";
  if (basisPoints >= 9900) return "text-yellow-600";
  if (basisPoints >= 9500) return "text-orange-600";
  return "text-red-600";
}

export function statusColor(isUp: boolean): string {
  return isUp ? "bg-emerald-500" : "bg-red-500";
}
