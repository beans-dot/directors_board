var MEETING_AUTO_HANDLER_ = 'createNextMeetingFolder';

function getMeetingAuto_() {
  return props_().getProperty('MEETING_AUTO') === '1';
}

function autoMeetingPlan_(runMondayKey) {
  if (weekdayKey_(runMondayKey) !== 1) return null;
  var next = addDaysKey_(runMondayKey, 7);
  var year = Number(String(next).slice(0, 4));
  if (year < 2026 || year > 2040) return null;
  if (isKoreanHoliday_(next)) return null;
  return { dateKey: next, time: '10:00' };
}

function syncMeetingAutoTrigger_() {
  var on = getMeetingAuto_();
  var triggers = ScriptApp.getProjectTriggers();
  var found = false;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() !== MEETING_AUTO_HANDLER_) continue;
    if (!on || found) {
      ScriptApp.deleteTrigger(triggers[i]);
      continue;
    }
    found = true;
  }
  if (on && !found) {
    ScriptApp.newTrigger(MEETING_AUTO_HANDLER_).timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(13).create();
  }
}

function logAuto_(target) {
  try {
    appendAccess_({ name: '자동생성', action: '자동생성', target: target });
  } catch (ignore) {}
}

function createNextMeetingFolder() {
  if (!getMeetingAuto_()) return;
  var now = new Date();
  var today = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd');
  var hour = Number(Utilities.formatDate(now, 'Asia/Seoul', 'H'));
  if (weekdayKey_(today) !== 1 || hour < 12 || hour > 20) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (props_().getProperty('MEETING_AUTO_DONE') === today) return;
    var next = addDaysKey_(today, 7);
    var year = Number(String(next).slice(0, 4));
    if (year < 2026 || year > 2040) {
      props_().setProperty('MEETING_AUTO_DONE', today);
      logAuto_(next + ' 달력 범위 밖');
      return;
    }
    if (isKoreanHoliday_(next)) {
      props_().setProperty('MEETING_AUTO_DONE', today);
      logAuto_(next + ' 휴일 생략');
      return;
    }
    if (!getRootFolderId_()) {
      logAuto_('자료 폴더 없음');
      return;
    }
    var folder = ensureDateFolder_(next);
    props_().setProperty('MEETING_DATE', folder.dateKey);
    props_().setProperty('MEETING_TIME', '10:00');
    props_().setProperty('MEETING_AUTO_DONE', today);
    logAuto_(folder.folderDate + ' 10:00');
  } finally {
    lock.releaseLock();
  }
}
