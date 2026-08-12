const {
  MIN_PASSWORD_LENGTH,
  resolveMinPasswordLength,
  validatePassword,
} = require('../../lib/passwordValidation');

describe('passwordValidation', () => {
  test('resolveMinPasswordLength honors configured values between 6 and 128', () => {
    expect(resolveMinPasswordLength({ min_password_length: 6 })).toBe(6);
    expect(resolveMinPasswordLength({ min_password_length: 8 })).toBe(8);
    expect(resolveMinPasswordLength({ min_password_length: 12 })).toBe(12);
    expect(resolveMinPasswordLength({ min_password_length: 4 })).toBe(MIN_PASSWORD_LENGTH);
    expect(resolveMinPasswordLength({ min_password_length: 200 })).toBe(128);
  });

  test('validatePassword rejects passwords below configured minimum', () => {
    const policy = {
      min_password_length: 6,
      require_uppercase: false,
      require_lowercase: false,
      require_number: false,
      require_symbol: false,
    };
    expect(validatePassword('12345', policy)).toEqual({
      valid: false,
      error: 'Password must be at least 6 characters',
    });
    expect(validatePassword('123456', policy)).toEqual({ valid: true });
  });
});
