var LUNAR_ANCHORS_ = {
  2026: ['2026-02-17', '2026-05-24', '2026-09-25'],
  2027: ['2027-02-07', '2027-05-13', '2027-09-15'],
  2028: ['2028-01-27', '2028-05-02', '2028-10-03'],
  2029: ['2029-02-13', '2029-05-20', '2029-09-22'],
  2030: ['2030-02-03', '2030-05-09', '2030-09-12'],
  2031: ['2031-01-23', '2031-05-28', '2031-10-01'],
  2032: ['2032-02-11', '2032-05-16', '2032-09-19'],
  2033: ['2033-01-31', '2033-05-06', '2033-09-08'],
  2034: ['2034-02-19', '2034-05-25', '2034-09-27'],
  2035: ['2035-02-08', '2035-05-15', '2035-09-16'],
  2036: ['2036-01-28', '2036-05-03', '2036-10-04'],
  2037: ['2037-02-15', '2037-05-22', '2037-09-24'],
  2038: ['2038-02-04', '2038-05-11', '2038-09-13'],
  2039: ['2039-01-24', '2039-04-30', '2039-10-02'],
  2040: ['2040-02-12', '2040-05-18', '2040-09-21'],
};

function addDaysKey_(dateKey, days) {
  var match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function weekdayKey_(dateKey) {
  var match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return -1;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

function onOrAfterWeekday_(dateKey, weekday) {
  var cursor = dateKey;
  for (var step = 0; step < 7; step++) {
    if (weekdayKey_(cursor) === weekday) return cursor;
    cursor = addDaysKey_(cursor, 1);
  }
  return cursor;
}

function scheduledElectionKeys_(year) {
  var keys = [];
  if (year >= 2024 && (year - 2024) % 4 === 0) keys.push(onOrAfterWeekday_(addDaysKey_(year + '-05-29', -50), 3));
  if (year >= 2022 && (year - 2022) % 4 === 0) keys.push(onOrAfterWeekday_(year + '-06-01', 3));
  return keys;
}

function holidayBases_(year) {
  if (year < 2026 || year > 2040) return [];
  var items = [
    { key: year + '-01-01', kind: 'newyear' },
    { key: year + '-03-01', kind: 'national' },
    { key: year + '-05-01', kind: 'labor' },
    { key: year + '-05-05', kind: 'children' },
    { key: year + '-06-06', kind: 'memorial' },
    { key: year + '-07-17', kind: 'national' },
    { key: year + '-08-15', kind: 'national' },
    { key: year + '-10-03', kind: 'national' },
    { key: year + '-10-09', kind: 'national' },
    { key: year + '-12-25', kind: 'christmas' },
  ];
  var lunar = LUNAR_ANCHORS_[year];
  if (lunar) {
    items.push({ key: addDaysKey_(lunar[0], -1), kind: 'seollal' });
    items.push({ key: lunar[0], kind: 'seollal' });
    items.push({ key: addDaysKey_(lunar[0], 1), kind: 'seollal' });
    items.push({ key: lunar[1], kind: 'buddha' });
    items.push({ key: addDaysKey_(lunar[2], -1), kind: 'chuseok' });
    items.push({ key: lunar[2], kind: 'chuseok' });
    items.push({ key: addDaysKey_(lunar[2], 1), kind: 'chuseok' });
  }
  scheduledElectionKeys_(year).forEach(function (key) {
    items.push({ key: key, kind: 'election' });
  });
  return items;
}

function nextOpenDay_(dateKey, bases) {
  var cursor = addDaysKey_(dateKey, 1);
  for (var step = 0; step < 14; step++) {
    if (weekdayKey_(cursor) !== 0 && !bases[cursor]) return cursor;
    cursor = addDaysKey_(cursor, 1);
  }
  return cursor;
}

function holidayMap_(year) {
  var grouped = {};
  [year - 1, year, year + 1].forEach(function (itemYear) {
    holidayBases_(itemYear).forEach(function (item) {
      if (!grouped[item.key]) grouped[item.key] = [];
      grouped[item.key].push(item.kind);
    });
  });
  var bases = {};
  Object.keys(grouped).forEach(function (key) {
    bases[key] = 1;
  });
  var targets = [];
  Object.keys(grouped).forEach(function (key) {
    var unique = {};
    grouped[key].forEach(function (kind) {
      unique[kind] = 1;
    });
    var kinds = Object.keys(unique);
    var count = 0;
    kinds.forEach(function (kind) {
      var weekday = weekdayKey_(key);
      var weekend = (kind === 'national' || kind === 'buddha' || kind === 'labor' || kind === 'children' || kind === 'christmas') && (weekday === 0 || weekday === 6);
      var sunday = (kind === 'seollal' || kind === 'chuseok') && weekday === 0;
      var overlapKind = kind === 'national' || kind === 'seollal' || kind === 'buddha' || kind === 'labor' || kind === 'children' || kind === 'chuseok' || kind === 'christmas';
      var overlap = overlapKind && weekday !== 0 && weekday !== 6 && kinds.length > 1;
      if (weekend || sunday || overlap) count++;
    });
    if (!count) return;
    var target = nextOpenDay_(key, bases);
    if (weekdayKey_(target) === 6) target = nextOpenDay_(target, bases);
    for (var index = 0; index < count; index++) targets.push(target);
  });
  var tally = {};
  targets.forEach(function (target) {
    tally[target] = (tally[target] || 0) + 1;
  });
  var holidays = {};
  Object.keys(bases).forEach(function (key) {
    holidays[key] = 1;
  });
  Object.keys(tally).forEach(function (target) {
    holidays[target] = 1;
    if (tally[target] < 2) return;
    var extra = nextOpenDay_(target, bases);
    if (weekdayKey_(extra) === 6) extra = nextOpenDay_(extra, bases);
    holidays[extra] = 1;
  });
  return holidays;
}

function isKoreanHoliday_(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return false;
  var year = Number(String(dateKey).slice(0, 4));
  return !!holidayMap_(year)[dateKey];
}
