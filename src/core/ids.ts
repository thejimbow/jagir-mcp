import { PLATFORMS, type Platform } from './types.js';

const ID_RE = new RegExp(`^(${PLATFORMS.join('|')}):([A-Za-z0-9]+)$`);

export function formatStayId(platform: Platform, id: string | number): string {
  return `${platform}:${id}`;
}

export function parseStayId(value: string): { platform: Platform; id: string } {
  const m = ID_RE.exec(value.trim());
  if (!m) throw new Error(`Invalid stay id "${value}". Expected "<platform>:<id>", e.g. "jajiga:3237270".`);
  return { platform: m[1] as Platform, id: m[2]! };
}
