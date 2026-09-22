// DailySummary tab (A:R) — one row per local calendar day, rolled up from
// Workouts and DailyHealth.
//
// **Derived, never authoritative.** Every row is rebuildable at any time from
// its sources. Nothing writes here by hand and no consumer may treat it as a
// source of truth: if this tab and `Workouts` disagree, `Workouts` is right
// and this tab is stale.
//
// It exists because neither source answers "what did this day look like" —
// `Workouts` is one row per activity, `DailyHealth` is health only — and
// computing that grain on read is fine for one day and bad for a year. The
// Journal scrolls.

var DAILY_SUMMARY_SHEET = 'DailySummary';
var DAILY_HEALTH_SHEET = 'DailyHealth';

/**
 * Venue modifiers whose activities are excluded from distance and ascent.
 *
 * A treadmill's "distance" and a trainer's "ascent" are machine estimates of
 * ground that was never covered. Summing them with outdoor figures produces a
 * number that means nothing. Mirrors INDOOR in cardio-fields.tsx.
 */
var INDOOR_SUB_TYPES = ['indoor'];

/** Activity types that can carry cardio attributes. Mirrors CARDIO_TYPES. */
var CARDIO_TYPES = ['bike', 'hike', 'run', 'walk'];

function isIndoor(workout) {
  return INDOOR_SUB_TYPES.indexOf(workout.sub_type) !== -1;
}

function isCardioWorkout(workout) {
  return CARDIO_TYPES.indexOf(workout.type) !== -1;
}

/** Outdoor cardio — the only activities distance and ascent are summed over. */
function isOutdoorCardio(workout) {
  return isCardioWorkout(workout) && !isIndoor(workout);
}

/**
 * Sums one nullable numeric field, counting how many values contributed.
 *
 * `{ total, withData, of }` is deliberately the same shape as `sumCovered` in
 * activities-helpers.ts rather than a parallel notion: a sum over nullable
 * fields is incomplete information without its coverage, and "58 km" alone
 * would silently overstate a day where only one of three rides was measured.
 *
 * A non-numeric or empty value is skipped but still counted in `of`, so the
 * gap stays visible rather than having to be inferred.
 */
function sumCovered(workouts, field) {
  var total = 0;
  var withData = 0;
  for (var i = 0; i < workouts.length; i++) {
    var n = parseInt(workouts[i][field], 10);
    if (isNaN(n)) continue;
    total += n;
    withData += 1;
  }
  return { total: total, withData: withData, of: workouts.length };
}

/** A plain sum over every activity, blank-safe. Used for the duration totals. */
function sumField(workouts, field) {
  var total = 0;
  for (var i = 0; i < workouts.length; i++) {
    var n = parseInt(workouts[i][field], 10);
    if (!isNaN(n)) total += n;
  }
  return total;
}

/**
 * "bike:mountain,weight" — each activity as type, plus its venue when it has
 * one, de-duplicated and stable-sorted so a rebuild is byte-identical.
 */
function describeActivityTypes(workouts) {
  var seen = {};
  var out = [];
  for (var i = 0; i < workouts.length; i++) {
    var w = workouts[i];
    var label = w.sub_type ? w.type + ':' + w.sub_type : w.type;
    if (!Object.prototype.hasOwnProperty.call(seen, label)) {
      seen[label] = true;
      out.push(label);
    }
  }
  return out.sort().join(',');
}

/**
 * Session effort, counted per workout (#131 AC4).
 *
 * Read from `Workouts!M` — the session-level value #113 established — never
 * derived from per-set effort in `Sets!J`. A hard set does not make a hard
 * session, and a session the athlete called Easy is Easy however the sets
 * went.
 *
 * A blank effort is counted in neither the max nor the counts: nobody said is
 * not a fourth effort level.
 */
function summarizeEffort(workouts) {
  var counts = {};
  var order = [];
  for (var i = 0; i < workouts.length; i++) {
    var e = workouts[i].effort;
    if (!e || EFFORTS.indexOf(e) === -1) continue;
    if (!Object.prototype.hasOwnProperty.call(counts, e)) {
      counts[e] = 0;
      order.push(e);
    }
    counts[e] += 1;
  }

  if (!order.length) return { max: '', counts: '' };

  // Hardest first, then by the EFFORTS order, so a rebuild is deterministic.
  var ranked = EFFORTS.slice().reverse().filter(function (e) {
    return Object.prototype.hasOwnProperty.call(counts, e);
  });

  return {
    max: ranked[0],
    counts: ranked.map(function (e) { return e + ':' + counts[e]; }).join(','),
  };
}

/** A DailyHealth row by date, or null. The tab may not exist yet. */
function getDailyHealth() {
  var spreadsheet = getSpreadsheet();
  var sheet = spreadsheet.getSheetByName(DAILY_HEALTH_SHEET);
  // The sync brings this tab. Until then every day is legitimately
  // health-less, which is not the same as a day of zeros (#131 AC2).
  if (!sheet) return {};

  var rows = getAllRows(sheet);
  var byDate = {};
  for (var i = 0; i < rows.length; i++) {
    var date = cell(rows[i][0]);
    if (!date) continue;
    byDate[date] = {
      steps: cell(rows[i][1]),
      resting_hr: cell(rows[i][2]),
      hrv: cell(rows[i][3]),
      sleep_total_s: cell(rows[i][4]),
      training_load: cell(rows[i][5]),
    };
  }
  return byDate;
}

/**
 * The summary for one day, or `null` when the day has nothing to report.
 *
 * A day with no activities and no health data produces **no row** rather than
 * a row of zeros (#131 AC1). Zero activities and "we have no information" are
 * different claims, and only one of them is true of a day nobody trained.
 */
function buildDaySummary(date, workouts, health, computedAt) {
  var health_ = health || null;
  if (!workouts.length && !health_) return null;

  var outdoorCardio = workouts.filter(isOutdoorCardio);
  var distance = sumCovered(outdoorCardio, 'distance_m');
  var ascent = sumCovered(outdoorCardio, 'ascent_m');
  var effort = summarizeEffort(workouts);

  return {
    date: date,
    activity_count: workouts.length ? String(workouts.length) : '',
    activity_types: describeActivityTypes(workouts),
    total_moving_s: workouts.length ? String(sumField(workouts, 'moving_seconds')) : '',
    total_elapsed_s: workouts.length ? String(sumField(workouts, 'elapsed_seconds')) : '',
    // Outdoor only. This will NOT equal the sum of the day's activity
    // distances on any day with an indoor session — correct, and surprising,
    // so it is documented wherever this is displayed.
    total_distance_m: outdoorCardio.length ? String(distance.total) : '',
    total_ascent_m: outdoorCardio.length ? String(ascent.total) : '',
    cardio_activity_count: outdoorCardio.length ? String(distance.of) : '',
    distance_withdata: outdoorCardio.length ? String(distance.withData) : '',
    ascent_withdata: outdoorCardio.length ? String(ascent.withData) : '',
    max_effort: effort.max,
    effort_counts: effort.counts,
    // Blank, not zero, on every day before the watch existed (#131 AC2).
    steps: health_ ? health_.steps : '',
    resting_hr: health_ ? health_.resting_hr : '',
    hrv: health_ ? health_.hrv : '',
    sleep_total_s: health_ ? health_.sleep_total_s : '',
    training_load: health_ ? health_.training_load : '',
    computed_at: computedAt,
  };
}

function summaryToRow(summary) {
  var row = [];
  for (var i = 0; i < DAILY_SUMMARY_FIELDS.length; i++) {
    row.push(cell(summary[DAILY_SUMMARY_FIELDS[i]]));
  }
  return row;
}

function rowToSummary(row, sheetRow) {
  var summary = {};
  for (var i = 0; i < DAILY_SUMMARY_FIELDS.length; i++) {
    summary[DAILY_SUMMARY_FIELDS[i]] = cell(row[i]);
  }
  summary.sheetRow = sheetRow;
  return summary;
}

/** Existing summary rows, by date. */
function getDailySummaries(filters) {
  var sheet = getSheet(DAILY_SUMMARY_SHEET);
  var rows = getAllRows(sheet);
  var summaries = [];
  for (var i = 0; i < rows.length; i++) {
    summaries.push(rowToSummary(rows[i], i + 2));
  }

  if (filters && filters.from) {
    var from = validateDate('from', filters.from);
    summaries = summaries.filter(function (s) { return s.date >= from; });
  }
  if (filters && filters.to) {
    var to = validateDate('to', filters.to);
    summaries = summaries.filter(function (s) { return s.date <= to; });
  }
  return summaries;
}

/** Every local date from `from` to `to`, inclusive. */
function datesInRange(from, to) {
  var dates = [];
  var cursor = new Date(from + 'T12:00:00Z'); // midday avoids any DST edge
  var end = new Date(to + 'T12:00:00Z');
  while (cursor.getTime() <= end.getTime()) {
    dates.push(Utilities.formatDate(cursor, 'UTC', 'yyyy-MM-dd'));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Rebuild summaries for a date range.
 *
 * **The range is a parameter, not a window** (#131 AC1). The nightly job and
 * the historical backfill call this same function with different ranges;
 * there is no second implementation for "catch up" to drift out of step with
 * the one for "last night".
 *
 * Idempotent: a day's row is a pure function of that day's sources plus
 * `computed_at`, so rebuilding twice over the same range produces identical
 * rows. `computed_at` is injected rather than read from the clock inside the
 * loop, so a single rebuild stamps one time rather than a spread of them.
 */
function rebuildDailySummary(from, to, options) {
  var opts = options || {};
  var start = validateDate('from', from);
  var end = validateDate('to', to);
  if (!start || !end) throw new Error('from and to are required (YYYY-MM-DD)');
  if (start > end) throw new Error('from must not be after to (' + start + ' > ' + end + ')');

  var computedAt = opts.computed_at || isoNow();

  var allWorkouts = getWorkouts();
  var byDate = {};
  for (var i = 0; i < allWorkouts.length; i++) {
    var w = allWorkouts[i];
    // A planned workout has not happened; it is not part of the day's rollup.
    if (w.status === 'planned') continue;
    if (!w.date) continue;
    if (!Object.prototype.hasOwnProperty.call(byDate, w.date)) byDate[w.date] = [];
    byDate[w.date].push(w);
  }

  var health = getDailyHealth();

  var sheet = getSheet(DAILY_SUMMARY_SHEET);
  var existing = getDailySummaries();
  var rowByDate = {};
  for (var j = 0; j < existing.length; j++) rowByDate[existing[j].date] = existing[j].sheetRow;

  var dates = datesInRange(start, end);
  var written = 0;
  var skipped = 0;
  var updated = 0;
  var removed = [];

  for (var k = 0; k < dates.length; k++) {
    var date = dates[k];
    var dayWorkouts = Object.prototype.hasOwnProperty.call(byDate, date) ? byDate[date] : [];
    var dayHealth = Object.prototype.hasOwnProperty.call(health, date) ? health[date] : null;

    var summary = buildDaySummary(date, dayWorkouts, dayHealth, computedAt);
    if (!summary) {
      skipped += 1;
      // A day that has a row but no longer earns one — its last workout was
      // deleted, say. The row has to go: this tab is derived, so a row that
      // its sources no longer imply is not stale data to be tolerated, it is
      // wrong data. Collected here and removed after the loop, bottom-to-top.
      if (Object.prototype.hasOwnProperty.call(rowByDate, date)) {
        removed.push(rowByDate[date]);
      }
      continue;
    }

    var row = summaryToRow(summary);
    if (Object.prototype.hasOwnProperty.call(rowByDate, date)) {
      // Update in place, so a re-run after a later import corrects the day
      // rather than duplicating it (#131 AC5).
      sheet.getRange(rowByDate[date], 1, 1, DAILY_SUMMARY_COLUMN_COUNT).setValues([asText(row)]);
      updated += 1;
    } else {
      sheet.appendRow(asText(row));
      rowByDate[date] = sheet.getLastRow();
      written += 1;
    }
  }

  // Bottom-to-top: removing a row shifts every row below it up, so descending
  // order is what keeps the remaining indices valid. The same rule as
  // everywhere else in this codebase.
  removed.sort(function (a, b) { return b - a; });
  for (var r = 0; r < removed.length; r++) {
    sheet.deleteRow(removed[r]);
  }

  return {
    from: start,
    to: end,
    days: dates.length,
    written: written,
    updated: updated,
    skipped: skipped,
    removed: removed.length,
    computed_at: computedAt,
  };
}

/**
 * The date range the existing history actually spans — the backfill's bounds,
 * so it does not have to be told them.
 */
function historyDateRange() {
  var workouts = getWorkouts();
  var min = '';
  var max = '';
  for (var i = 0; i < workouts.length; i++) {
    var d = workouts[i].date;
    if (!d || workouts[i].status === 'planned') continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  return { from: min, to: max };
}
