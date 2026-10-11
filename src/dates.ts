export function formatTime(value: string | number): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatTimestamp(value?: string | number): string {
  if (value == null || value === "") return "Never";
  const date = new Date(value);
  return `${date.toLocaleDateString(undefined, { year: "2-digit", month: "2-digit", day: "2-digit" })} ${formatTime(value)}`;
}
