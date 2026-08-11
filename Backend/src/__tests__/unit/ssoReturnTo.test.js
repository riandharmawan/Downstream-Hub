const { isSafeSsoReturnTo } = require('../../lib/ssoReturnTo');

describe('ssoReturnTo', () => {
  test('isSafeSsoReturnTo allows authorize paths', () => {
    expect(isSafeSsoReturnTo('/api/sso/authorize?client_id=a&redirect_uri=b')).toBe(true);
  });

  test('isSafeSsoReturnTo rejects absolute URLs', () => {
    expect(isSafeSsoReturnTo('https://evil.example/api/sso/authorize')).toBe(false);
  });

  test('isSafeSsoReturnTo rejects other paths', () => {
    expect(isSafeSsoReturnTo('/login')).toBe(false);
    expect(isSafeSsoReturnTo('/api/sso/token')).toBe(false);
  });

  test('isSafeSsoReturnTo rejects protocol-relative paths', () => {
    expect(isSafeSsoReturnTo('//evil.example/api/sso/authorize')).toBe(false);
  });
});
