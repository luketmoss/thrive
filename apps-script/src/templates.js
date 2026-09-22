// Templates tab (A:H). One row per exercise; a template is the group of rows
// sharing a template_id.

var TEMPLATES_SHEET = 'Templates';

/** "4-5" -> "5". Mirrors normalizeRangeToMax in templates-api.ts. */
function normalizeRangeToMax(value) {
  var trimmed = String(value === undefined || value === null ? '' : value).trim();
  if (!trimmed) return trimmed;
  var parts = trimmed.split('-')
    .map(function (s) { return Number(s.trim()); })
    .filter(function (n) { return !isNaN(n); });
  return parts.length ? String(Math.max.apply(null, parts)) : trimmed;
}

function rowToTemplateRow(row, sheetRow) {
  return {
    template_id: cell(row[0]),
    template_name: cell(row[1]),
    order: Number(row[2]) || 0,
    exercise_id: cell(row[3]),
    exercise_name: cell(row[4]),
    section: cell(row[5]),
    sets: normalizeRangeToMax(cell(row[6])),
    reps: normalizeRangeToMax(cell(row[7])),
    sheetRow: sheetRow,
  };
}

function templateRowValues(templateId, name, ex, order) {
  return [
    templateId, name, order,
    cell(ex.exercise_id), cell(ex.exercise_name), cell(ex.section),
    String(ex.sets), String(ex.reps),
  ];
}

/** Every template row, in sheet order. */
function getTemplateRows() {
  var rows = getAllRows(getSheet(TEMPLATES_SHEET));
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    out.push(rowToTemplateRow(rows[i], i + 2));
  }
  return out;
}

/** Rows grouped into templates, exercises by order and templates by name. */
function groupTemplateRows(rows) {
  var order = [];
  var byId = {};
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!Object.prototype.hasOwnProperty.call(byId, row.template_id)) {
      byId[row.template_id] = { id: row.template_id, name: row.template_name, exercises: [] };
      order.push(row.template_id);
    }
    byId[row.template_id].exercises.push(row);
  }

  var templates = order.map(function (id) { return byId[id]; });
  for (var j = 0; j < templates.length; j++) {
    templates[j].exercises.sort(function (a, b) { return a.order - b.order; });
  }
  return templates.sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function getTemplates() {
  return groupTemplateRows(getTemplateRows());
}

/** A template by id or name, or a thrown error listing what is available. */
function resolveTemplate(ref, templates) {
  var q = String(ref === undefined ? '' : ref).trim().toLowerCase();
  if (q === '') throw new Error('A template reference is required.');

  var list = templates || getTemplates();
  var match = null;
  var i;
  for (i = 0; i < list.length; i++) if (list[i].id.toLowerCase() === q) { match = list[i]; break; }
  if (!match) for (i = 0; i < list.length; i++) if (list[i].name.toLowerCase() === q) { match = list[i]; break; }
  if (!match) for (i = 0; i < list.length; i++) if (list[i].name.toLowerCase().indexOf(q) !== -1) { match = list[i]; break; }

  if (!match) {
    throw new Error(
      'No template matching "' + ref + '". Available: ' +
      (list.map(function (t) { return t.name; }).join(', ') || '(none)')
    );
  }
  return match;
}

/**
 * Validate an exercise list against the library, resolving each reference and
 * writing the library's *current* name rather than whatever the caller sent.
 *
 * Every problem is collected rather than thrown on the first: someone fixing
 * a template should see all of them at once, not one per round trip.
 */
function resolveTemplateExercises(exercises, library) {
  var resolved = [];
  var errors = [];

  exercises.forEach(function (ex, i) {
    var where = 'exercises[' + i + '] "' + (ex.exercise || ex.exercise_id || '') + '"';

    var found;
    try {
      found = resolveExercise(ex.exercise || ex.exercise_id, library);
    } catch (err) {
      errors.push(where + ': ' + (err.message || String(err)));
      return;
    }

    if (ex.section !== undefined && ex.section !== '' && SECTIONS.indexOf(ex.section) === -1) {
      errors.push(where + ': invalid section "' + ex.section + '". Expected one of: ' + SECTIONS.join(', '));
      return;
    }

    var sets = Number(ex.sets);
    if (!isFinite(sets) || Math.floor(sets) !== sets || sets < 1) {
      errors.push(where + ': sets must be a whole number of at least 1, got ' + JSON.stringify(ex.sets));
      return;
    }

    resolved.push({
      exercise_id: found.id,
      // The library's name, never the caller's copy — that is #120.
      exercise_name: found.name,
      section: cell(ex.section),
      sets: String(sets),
      reps: normalizeRangeToMax(ex.reps),
    });
  });

  return { exercises: resolved, errors: errors };
}

function createTemplate(data) {
  if (!data || !data.name) throw new Error('name is required');
  if (!data.exercises || !data.exercises.length) {
    throw new Error('a template needs at least one exercise');
  }

  var resolved = resolveTemplateExercises(data.exercises, getExercises());
  if (resolved.errors.length) throw new Error(resolved.errors.join('; '));

  var templateId = data.id || 'tpl_' + Utilities.getUuid().slice(0, 8);
  var sheet = getSheet(TEMPLATES_SHEET);
  for (var i = 0; i < resolved.exercises.length; i++) {
    sheet.appendRow(asText(templateRowValues(templateId, data.name, resolved.exercises[i], i + 1)));
  }

  return { id: templateId, name: data.name, exercises: resolved.exercises };
}

/**
 * Replace a template's rows wholesale — delete, then append — as the app does.
 *
 * Deletion is bottom-to-top. Removing a row shifts every row below it up, so
 * descending order is what keeps the remaining indices valid; ascending order
 * deletes the wrong rows after the first. The same rule as everywhere else in
 * this codebase.
 */
function replaceTemplate(templateId, data) {
  if (!templateId) throw new Error('template_id is required');
  if (!data || !data.exercises || !data.exercises.length) {
    throw new Error('a template needs at least one exercise');
  }

  var existing = getTemplateRows().filter(function (r) { return r.template_id === templateId; });
  if (!existing.length) throw new Error('Template "' + templateId + '" not found');

  var name = data.name || existing[0].template_name;

  var resolved = resolveTemplateExercises(data.exercises, getExercises());
  if (resolved.errors.length) throw new Error(resolved.errors.join('; '));

  var sheet = getSheet(TEMPLATES_SHEET);
  var rowNumbers = existing
    .map(function (r) { return r.sheetRow; })
    .sort(function (a, b) { return b - a; });
  for (var i = 0; i < rowNumbers.length; i++) {
    sheet.deleteRow(rowNumbers[i]);
  }

  for (var j = 0; j < resolved.exercises.length; j++) {
    sheet.appendRow(asText(templateRowValues(templateId, name, resolved.exercises[j], j + 1)));
  }

  return { id: templateId, name: name, exercises: resolved.exercises };
}
