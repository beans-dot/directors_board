function safeEqual_(a, b) {
  a = String(a);
  b = String(b);
  var len = Math.max(a.length, b.length);
  var diff = a.length ^ b.length;
  for (var i = 0; i < len; i++) {
    var ca = i < a.length ? a.charCodeAt(i) : 0;
    var cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

function b64url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function signToken_(deviceId) {
  var secret = requireScript_('TOKEN_SECRET');
  var version = props_().getProperty('ADMIN_TOKEN_VERSION') || '1';
  var exp = Date.now() + 365 * 24 * 60 * 60 * 1000;
  var payload = b64url_(Utilities.newBlob(deviceId + '.' + exp + '.' + version).getBytes());
  var mac = Utilities.computeHmacSha256Signature(payload, secret);
  return { adminToken: payload + '.' + b64url_(mac), exp: exp };
}

function verifyAdminToken_(token, deviceId) {
  if (!token) fail_('UNAUTHORIZED', 'Admin 인증이 필요합니다.');
  var parts = String(token).split('.');
  if (parts.length !== 2) fail_('UNAUTHORIZED', 'Admin 인증이 만료되었습니다.');
  var secret = requireScript_('TOKEN_SECRET');
  var mac = Utilities.computeHmacSha256Signature(parts[0], secret);
  if (!safeEqual_(b64url_(mac), parts[1])) fail_('UNAUTHORIZED', 'Admin 인증이 만료되었습니다.');
  var raw = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  var bits = raw.split('.');
  if (bits.length !== 3 || bits[0] !== deviceId) fail_('UNAUTHORIZED', 'Admin 인증이 만료되었습니다.');
  if (Number(bits[1]) < Date.now()) fail_('UNAUTHORIZED', 'Admin 인증이 만료되었습니다.');
  var version = props_().getProperty('ADMIN_TOKEN_VERSION') || '1';
  if (bits[2] !== version) fail_('UNAUTHORIZED', 'Admin 인증이 만료되었습니다.');
}

function adminLogin(payload, req) {
  var deviceId = req.deviceId;
  var password = String(payload.password || '');
  var expected = props_().getProperty('ADMIN_PASSWORD');
  if (!expected) fail_('CONFIG_MISSING', 'Admin 비밀번호가 설정되지 않았습니다.');
  if (!safeEqual_(password, expected)) {
    appendAccess_({ deviceId: deviceId, action: 'admin로그인실패', target: '' });
    fail_('WRONG_PASSWORD', '비밀번호가 올바르지 않습니다.');
  }
  markAdmin_(deviceId);
  appendAccess_({ deviceId: deviceId, name: '관리자', action: 'admin로그인성공', target: '' });
  return signToken_(deviceId);
}
