/** Shown when a numeric or text field has no value. */
export const EMPTY = "-";

/** Split "Agent Name - address" lines (still parses legacy em/en dashes in stored data). */
export function splitRegistryLine(value: string): { name: string; address: string | null } {
  const match = value.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!match) return { name: value.trim(), address: null };
  return { name: match[1].trim(), address: match[2].trim() };
}
