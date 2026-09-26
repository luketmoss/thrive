// The dead-man's switch (#156, sync plan §10): is the newest SyncLog row
// recent enough that the sync is still running? #200 adds a second log,
// WithingsSyncLog, checked by its own watchdog with `--log withings`.
//
// A job that doesn't run cannot report itself, so this runs as its own
// workflow on its own schedule. It asks only whether the sync ran, not whether
// it succeeded: a failed run already sends Actions' failure email.

/**
 * 16 hours. The runs are 00:17, 09:17, 13:17 and 18:17 UTC, so the gaps are
 * 9, 4, 5 and 6 hours. One dropped run leaves at most 15 (00:17 skipped:
 * 18:17 to 09:17), and an hour of scheduler delay on top gives 16. So a single
 * dropped run, which the rolling window heals, never alarms, and a stopped job
 * is reported within 16 hours plus the watchdog's 3.
 */
export const DEFAULT_THRESHOLD_HOURS = 16;

/**
 * 14 hours, for the Withings sync (#200). Its runs are 01:41, 07:41, 13:41 and
 * 19:41 UTC, 6 hours apart. One dropped run leaves 12, and an hour of
 * scheduler delay makes 13. So a single dropped run never alarms, and a
 * stopped job is reported within 14 hours plus the watchdog's 3.
 */
export const WITHINGS_THRESHOLD_HOURS = 14;

/**
 * The logs a watchdog can check, each its own tab (#200). They never mix:
 * `coros` reads only SyncLog, as it always has, so a Withings run can never
 * make a stopped COROS sync look alive, nor the reverse.
 */
export const LOGS = {
  coros: { tab: 'SyncLog', sync: 'COROS sync', workflow: 'coros-sync', thresholdHours: DEFAULT_THRESHOLD_HOURS },
  withings: {
    tab: 'WithingsSyncLog', sync: 'Withings sync', workflow: 'withings-sync', thresholdHours: WITHINGS_THRESHOLD_HOURS,
  },
};

const HOUR = 60 * 60 * 1000;

/**
 * @param {{ api: { getSyncLog: (limit: number, opts?: { log?: string }) => Promise<object[]> },
 *   now?: Date, thresholdHours?: number, log?: 'coros' | 'withings' }} opts
 *   `log` defaults to `coros`, whose read is exactly the one before #200:
 *   `getSyncLog(1)`, no log option.
 * @returns {Promise<{ ok: boolean, message: string, newest?: object, ageHours?: number }>}
 *   Never throws for an unreadable log: that is `ok: false` too.
 */
export async function checkFreshness({ api, now = new Date(), thresholdHours, log = 'coros' }) {
  const which = LOGS[log];
  if (!which) throw new Error(`log must be one of ${Object.keys(LOGS).join(', ')}, got "${log}"`);
  if (thresholdHours === undefined) thresholdHours = which.thresholdHours;
  if (!(thresholdHours > 0)) throw new Error(`threshold must be a positive number of hours, got ${thresholdHours}`);
  const limit = `threshold ${thresholdHours} h`;
  const { tab, sync, workflow } = which;

  let rows;
  try {
    rows = log === 'coros' ? await api.getSyncLog(1) : await api.getSyncLog(1, { log });
  } catch (err) {
    return {
      ok: false,
      message: `Could not read ${tab} (${err.name ?? 'Error'}${err.action ? `, ${err.action}` : ''}), so nobody ` +
        `can tell whether the ${sync} is running. The sync writes through the same API, so it is ` +
        'probably failing too.',
    };
  }

  const newest = Array.isArray(rows) ? rows[0] : undefined;
  if (!newest) {
    return { ok: false, message: `${tab} is empty: the ${sync} has never recorded a run (${limit}).` };
  }

  const started = Date.parse(newest.started_at);
  if (Number.isNaN(started)) {
    return {
      ok: false, newest,
      message: `The newest ${tab} row, ${newest.run_id}, has an unreadable started_at ("${newest.started_at}").`,
    };
  }

  const ageHours = (now.getTime() - started) / HOUR;
  const described = `newest ${tab} row ${newest.run_id} started ${newest.started_at}, ` +
    `${ageHours.toFixed(1)} h ago, status ${newest.status || '(blank)'}; ${limit}`;
  if (ageHours > thresholdHours) {
    return {
      ok: false, newest, ageHours,
      message: `The ${sync} has not run for ${ageHours.toFixed(1)} hours: ${described}. ` +
        `Check Actions → ${workflow}: is its schedule still enabled, and are runs being cancelled or timing out?`,
    };
  }
  return { ok: true, newest, ageHours, message: `The ${sync} is running: ${described}.` };
}

/**
 * `--now <ISO>`, `--threshold-hours <n>` (for proving the check trips) and
 * `--log withings` (#200). Without `--log` it is the COROS check, as before;
 * the threshold defaults to the chosen log's.
 */
export function parseDeadmanArgs(argv, env = {}) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const logArg = value('--log');
  const log = argv.includes('--log') ? logArg : 'coros';
  if (!Object.hasOwn(LOGS, log)) {
    throw new Error(`--log must be one of ${Object.keys(LOGS).join(', ')}, got "${logArg}"`);
  }
  const nowArg = value('--now');
  const thresholdArg = value('--threshold-hours') ?? env.DEADMAN_THRESHOLD_HOURS;
  const now = nowArg === undefined ? new Date() : new Date(nowArg);
  if (Number.isNaN(now.getTime())) throw new Error(`--now must be an ISO instant, got "${nowArg}"`);
  const thresholdHours = thresholdArg === undefined || thresholdArg === '' ? LOGS[log].thresholdHours : Number(thresholdArg);
  if (!(thresholdHours > 0)) throw new Error(`--threshold-hours must be a positive number, got "${thresholdArg}"`);
  return { now, thresholdHours, log };
}
