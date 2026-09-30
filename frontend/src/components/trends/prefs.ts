// Trends controls remembered on this device (#242 AC1). Every localStorage
// touch is wrapped: private mode, a full quota or a blocked origin must never
// break the screen. A missing, unknown or unreadable value gives the default;
// a failed write is ignored, and the choice still applies for this visit.

import { TREND_GROUPS, type TrendGroup } from './metrics';
import { RANGES, AVERAGES, VIEWS, type RangeKey, type AverageKey, type ViewKey } from './series';

export interface Pref<T extends string> {
  key: string;
  options: readonly T[];
  fallback: T;
}

export const RANGE_PREF: Pref<RangeKey> = { key: 'thrive-trends-range', options: RANGES, fallback: '3M' };
export const AVERAGE_PREF: Pref<AverageKey> = { key: 'thrive-trends-average', options: AVERAGES, fallback: '7d' };
export const VIEW_PREF: Pref<ViewKey> = { key: 'thrive-trends-view', options: VIEWS, fallback: 'Chart' };

/** The metric-group choice (#243): any registered group id; the first group when missing or unknown. */
export function groupPref(groups: readonly TrendGroup[]): Pref<string> {
  return { key: 'thrive-trends-group', options: groups.map((g) => g.id), fallback: groups[0]?.id ?? '' };
}
export const GROUP_PREF: Pref<string> = groupPref(TREND_GROUPS);

/** The stored choice, or the default when it is missing, unknown or unreadable. */
export function readPref<T extends string>(pref: Pref<T>): T {
  try {
    const v = localStorage.getItem(pref.key);
    return v !== null && (pref.options as readonly string[]).includes(v) ? (v as T) : pref.fallback;
  } catch {
    return pref.fallback;
  }
}

/** Store a choice. Never throws. */
export function writePref<T extends string>(pref: Pref<T>, value: T): void {
  try {
    localStorage.setItem(pref.key, value);
  } catch {
    // Storage unavailable: the choice holds for this visit only.
  }
}
