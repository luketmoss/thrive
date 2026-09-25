// A synced activity's archived COROS payload, read from the bot's Drive (#179).
//
// The archive (#152) is `Thrive COROS/activities/<YYYY>/<MM>/<activityId>.json`
// in the bot account's Drive, written by the sync. This script runs as the
// bot, so with `drive.readonly` it can read those files.
//
// The caller names a **workout**, never a Drive file: the file is the one the
// row's `raw_ref` names. That alone is not enough, because `raw_ref` is an
// ordinary column that `updateWorkout` can set, and the same Drive holds
// `coros-token.json`. So the file must also be, by name, place and content,
// that activity's archive file before a single character of it goes back.
//
// Nothing here logs. A payload is the user's own watch data and this repo is
// public, so no line of it may reach a log, and every refusal is fixed text
// that quotes nothing read from Drive.

/** At most this many characters of payload text per response (AC3). */
var PAYLOAD_PAGE_CHARS = 20000;

/** An archive file is ~1 KB to ~1 MB. Anything this large is not one. */
var PAYLOAD_FILE_MAX_BYTES = 5 * 1024 * 1024;

var ARCHIVE_ROOT_FOLDER = 'Thrive COROS';
var ARCHIVE_ACTIVITIES_FOLDER = 'activities';

/** The one message for "raw_ref does not name this activity's archive file". */
var NOT_AN_ARCHIVE_FILE =
  'raw_ref on this workout does not name its COROS archive file, so nothing was read from it. ' +
  'The next sync run rewrites raw_ref.';

var DRIVE_UNAUTHORIZED =
  'The script is not yet allowed to read Drive: its owner must re-authorize it for the ' +
  'drive.readonly scope (apps-script/README.md, "Setup").';

/**
 * One page of a workout's archived payload text.
 *
 * Returns `{ workout_id, source_activity_id, raw_ref, tool, fetched_at, text,
 * offset, total_chars, next_offset }`. Throws, with fixed text, for every
 * refusal in AC2.
 */
function getWorkoutPayload(id, offsetParam) {
  var offset = parsePayloadOffset(offsetParam);

  var workout = getWorkout(id);
  if (!workout) throw new Error('Workout "' + id + '" not found');
  if (!workout.raw_ref) {
    throw new Error(
      'Workout "' + id + '" has no archived COROS payload (raw_ref is blank): it was logged by ' +
      'hand, or synced before the archive existed.'
    );
  }
  if (!workout.source_activity_id) {
    throw new Error(
      'Workout "' + id + '" has a raw_ref but no source_activity_id, so its archive file cannot be ' +
      'confirmed. Nothing was read.'
    );
  }

  var record = readArchiveRecord(workout.raw_ref, workout.source_activity_id);
  var text = payloadText(record.payload);
  if (offset > 0 && offset >= text.length) {
    throw new Error(
      'offset ' + offset + ' is past the end: the payload is ' + text.length + ' characters.'
    );
  }

  var end = pageEnd(text, offset, PAYLOAD_PAGE_CHARS);
  return {
    workout_id: workout.id,
    source_activity_id: workout.source_activity_id,
    raw_ref: workout.raw_ref,
    tool: typeof record.tool === 'string' ? record.tool : '',
    fetched_at: typeof record.fetched_at === 'string' ? record.fetched_at : '',
    text: text.slice(offset, end),
    offset: offset,
    total_chars: text.length,
    next_offset: end < text.length ? end : null,
  };
}

/** `offset` as a whole number of characters. Absent or '' is 0. */
function parsePayloadOffset(value) {
  if (value === undefined || value === null || value === '') return 0;
  var s = String(value).trim();
  if (!/^\d+$/.test(s)) throw new Error('offset must be a whole number of characters (0 or more)');
  return Number(s);
}

/**
 * Where a page starting at `offset` ends. Never between the two halves of a
 * surrogate pair: COROS payloads open with an emoji, and half of one is not a
 * character in either page.
 */
function pageEnd(text, offset, size) {
  var end = Math.min(offset + size, text.length);
  if (end < text.length && end > offset) {
    var before = text.charCodeAt(end - 1);
    if (before >= 0xd800 && before <= 0xdbff) end -= 1;
  }
  return end;
}

/**
 * The payload as prose. The sync stores COROS's text byte for byte, and COROS
 * serves it as a JSON string literal, quotes and `\n` escapes included. Decode
 * that one layer when it is one; anything else is returned as stored.
 */
function payloadText(payload) {
  try {
    var decoded = JSON.parse(payload);
    if (typeof decoded === 'string') return decoded;
  } catch (err) {
    // Not a JSON string literal: the stored text is the text.
  }
  return payload;
}

/**
 * The archive record at `fileId`, confirmed to be `activityId`'s archive
 * file. Throws NOT_AN_ARCHIVE_FILE for anything else, and DRIVE_UNAUTHORIZED
 * while the owner has not granted the scope.
 */
function readArchiveRecord(fileId, activityId) {
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    // Drive's own message is not passed on: it can name the file.
    if (isDrivePermissionError(err)) throw new Error(DRIVE_UNAUTHORIZED);
    throw new Error(NOT_AN_ARCHIVE_FILE);
  }

  var record;
  try {
    if (file.isTrashed()) throw new Error('trashed');
    if (file.getName() !== activityId + '.json') throw new Error('name');
    if (file.getSize() > PAYLOAD_FILE_MAX_BYTES) throw new Error('size');
    if (!isInActivityArchive(file)) throw new Error('place');
    record = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
  } catch (err) {
    if (isDrivePermissionError(err)) throw new Error(DRIVE_UNAUTHORIZED);
    throw new Error(NOT_AN_ARCHIVE_FILE);
  }

  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      record.source !== 'coros' || String(record.activity_id) !== String(activityId) ||
      typeof record.payload !== 'string') {
    throw new Error(NOT_AN_ARCHIVE_FILE);
  }
  return record;
}

/**
 * Whether the file sits at `Thrive COROS/activities/<YYYY>/<MM>/`. Each folder
 * must be the only parent at its level, as the sync makes them.
 */
function isInActivityArchive(file) {
  var month = onlyParent(file);
  if (!month || !/^\d{2}$/.test(month.getName())) return false;
  var year = onlyParent(month);
  if (!year || !/^\d{4}$/.test(year.getName())) return false;
  var activities = onlyParent(year);
  if (!activities || activities.getName() !== ARCHIVE_ACTIVITIES_FOLDER) return false;
  var root = onlyParent(activities);
  return !!root && root.getName() === ARCHIVE_ROOT_FOLDER;
}

/** The single parent folder of a file or folder, or null for none or several. */
function onlyParent(item) {
  var parents = item.getParents();
  if (!parents.hasNext()) return null;
  var parent = parents.next();
  return parents.hasNext() ? null : parent;
}

/**
 * Whether Drive refused because the scope is not granted. Deliberately
 * narrow: "No item with the given ID could be found ... or you do not have
 * permission to access it" is a missing file, not a missing scope.
 */
function isDrivePermissionError(err) {
  var message = String((err && err.message) || err);
  return /Required permissions|Authorization is required|do not have permission to call/i.test(message);
}
