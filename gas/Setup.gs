function setup() {
  var ss = sheet_();
  ensureTab_(ss, TAB_SETTINGS_, ['키', '값', '설명']);
  ensureTab_(ss, TAB_DEVICES_, ['deviceId', '이름', '보직', '첫접속', '마지막접속', '브라우저', 'admin(Y/N)', 'admin전환시각']);
  ensureTab_(ss, TAB_ACCESS_, ['deviceId', '이름', '날짜폴더', '동작', '대상', '시각']);
  ensureTab_(ss, TAB_SEND_, ['deviceId', '이름', '날짜폴더', '받는주소', '첨부수', '용량(bytes)', '방식(첨부/링크)', '결과(성공/실패)', '오류', '시각']);
  if (!getSetting_('결과보관일수')) setSetting_('결과보관일수', '7', '링크 발송 파일 보관 일수');
  setSetting_('루트폴더ID', getSetting_('루트폴더ID'), '비우면 Script Property ROOT_FOLDER_ID를 사용합니다.');
  if (!props_().getProperty('TOKEN_SECRET')) {
    props_().setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
  if (!props_().getProperty('ADMIN_TOKEN_VERSION')) props_().setProperty('ADMIN_TOKEN_VERSION', '1');
  if (!props_().getProperty('MAIL_FROM_NAME')) props_().setProperty('MAIL_FROM_NAME', '보직회의 지원 시스템');
  if (!props_().getProperty('OFFICERS')) props_().setProperty('OFFICERS', JSON.stringify(defaultOfficers_()));
  installCleanupTrigger_();
  syncMeetingAutoTrigger_();
  try {
    syncPackTrigger_(getMeeting_());
  } catch (ignorePack) {}
  return 'ok';
}

function installCleanupTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'cleanupResults') return;
  }
  ScriptApp.newTrigger('cleanupResults').timeBased().atHour(3).everyDays(1).create();
}

function cleanupResults() {
  var folderId = props_().getProperty('RESULT_FOLDER_ID');
  if (folderId) {
    var keep = getResultKeepDays_();
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keep);
    var root = DriveApp.getFolderById(folderId);
    var folders = root.getFolders();
    while (folders.hasNext()) {
      var folder = folders.next();
      if (folder.getLastUpdated() < cutoff) folder.setTrashed(true);
    }
  }
  cleanupSendQueue_();
}
