var TAB_SETTINGS_ = '설정';
var TAB_DEVICES_ = '기기';
var TAB_ACCESS_ = '접속기록';
var TAB_SEND_ = '발송기록';

function sheet_() {
  var id = requireScript_('SHEET_ID');
  return SpreadsheetApp.openById(id);
}

function ensureTab_(ss, name, headers) {
  var tab = ss.getSheetByName(name);
  if (!tab) tab = ss.insertSheet(name);
  if (String(tab.getRange(1, 1).getValue() || '') === '') {
    tab.getRange(1, 1, 1, headers.length).setValues([headers]);
    tab.setFrozenRows(1);
  }
  return tab;
}

function getSetting_(key) {
  var tab = sheet_().getSheetByName(TAB_SETTINGS_);
  if (!tab) return '';
  var values = tab.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === key) return String(values[i][1] || '');
  }
  return '';
}

function setSetting_(key, value, description) {
  var tab = ensureTab_(sheet_(), TAB_SETTINGS_, ['키', '값', '설명']);
  var values = tab.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === key) {
      tab.getRange(i + 1, 2, 1, 2).setValues([[value, description || values[i][2]]]);
      return;
    }
  }
  tab.appendRow([key, value, description || '']);
}

function findDeviceRow_(tab, deviceId) {
  var values = tab.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === deviceId) return { index: i + 1, row: values[i] };
  }
  return null;
}

function upsertDevice_(device) {
  var tab = ensureTab_(sheet_(), TAB_DEVICES_, ['deviceId', '이름', '보직', '첫접속', '마지막접속', '브라우저', 'admin(Y/N)', 'admin전환시각']);
  var found = findDeviceRow_(tab, device.deviceId);
  var now = stampKst_();
  if (!found) {
    tab.appendRow([device.deviceId, device.name || '', device.position || '', now, now, device.userAgent || '', 'N', '']);
    return { created: true };
  }
  var row = found.row;
  tab.getRange(found.index, 2, 1, 5).setValues([[
    device.name != null ? device.name : row[1],
    device.position != null ? device.position : row[2],
    row[3],
    now,
    device.userAgent != null ? device.userAgent : row[5],
  ]]);
  return { created: false, admin: row[6] === 'Y' };
}

function touchDevice_(deviceId) {
  var tab = sheet_().getSheetByName(TAB_DEVICES_);
  if (!tab) return null;
  var found = findDeviceRow_(tab, deviceId);
  if (!found) return null;
  tab.getRange(found.index, 5).setValue(stampKst_());
  return { name: found.row[1], position: found.row[2], admin: found.row[6] };
}

function markAdmin_(deviceId) {
  var tab = ensureTab_(sheet_(), TAB_DEVICES_, ['deviceId', '이름', '보직', '첫접속', '마지막접속', '브라우저', 'admin(Y/N)', 'admin전환시각']);
  var found = findDeviceRow_(tab, deviceId);
  if (!found) fail_('NOT_REGISTERED', '먼저 이름과 보직을 등록해 주세요.');
  var now = stampKst_();
  tab.getRange(found.index, 2, 1, 2).setValues([['관리자', '기획처']]);
  tab.getRange(found.index, 5).setValue(now);
  tab.getRange(found.index, 7, 1, 2).setValues([['Y', now]]);
}

function deviceName_(deviceId) {
  var tab = sheet_().getSheetByName(TAB_DEVICES_);
  if (!tab) return '';
  var found = findDeviceRow_(tab, deviceId);
  return found ? String(found.row[1] || '') : '';
}

function appendAccess_(entry) {
  var tab = ensureTab_(sheet_(), TAB_ACCESS_, ['deviceId', '이름', '날짜폴더', '동작', '대상', '시각']);
  tab.appendRow([
    entry.deviceId || '',
    entry.name || deviceName_(entry.deviceId),
    entry.folderDate || '',
    entry.action || '',
    entry.target || '',
    stampKst_(),
  ]);
}

function appendSendLog_(entry) {
  var tab = ensureTab_(sheet_(), TAB_SEND_, ['deviceId', '이름', '날짜폴더', '받는주소', '첨부수', '용량(bytes)', '방식(첨부/링크)', '결과(성공/실패)', '오류', '시각']);
  tab.appendRow([
    entry.deviceId || '',
    deviceName_(entry.deviceId),
    entry.folderDate || '',
    entry.to || '',
    entry.fileCount || 0,
    entry.bytes || 0,
    entry.mode || '',
    entry.result || '',
    entry.error || '',
    stampKst_(),
  ]);
}

function readRows_(name) {
  var tab = sheet_().getSheetByName(name);
  if (!tab) return [];
  var values = tab.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (cell) { return String(cell); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = values[i][c];
    rows.push(obj);
  }
  return rows;
}
