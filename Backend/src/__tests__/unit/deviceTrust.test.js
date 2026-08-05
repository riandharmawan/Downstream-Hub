/**
 * Unit tests for device trust / MFA bypass window evaluation.
 */
const deviceTrust = require('../../lib/deviceTrust');

describe('deviceTrust', () => {
  describe('isWithinBypassWindow', () => {
    const policyRolling = { login_mfa_bypass_mode: 'rolling_24h', login_mfa_bypass_hours: 24 };
    const policyCalendar = { login_mfa_bypass_mode: 'calendar_day', login_mfa_bypass_timezone: 'UTC' };

    test('rolling_24h — within window', () => {
      const now = new Date('2026-08-05T14:00:00.000Z');
      const device = { last_verified_at: new Date('2026-08-05T02:00:00.000Z') };
      expect(deviceTrust.isWithinBypassWindow(device, policyRolling, now)).toBe(true);
    });

    test('rolling_24h — outside window', () => {
      const now = new Date('2026-08-05T14:00:00.000Z');
      const device = { last_verified_at: new Date('2026-08-04T13:00:00.000Z') };
      expect(deviceTrust.isWithinBypassWindow(device, policyRolling, now)).toBe(false);
    });

    test('calendar_day — same UTC day', () => {
      const now = new Date('2026-08-05T23:00:00.000Z');
      const device = { last_verified_at: new Date('2026-08-05T01:00:00.000Z') };
      expect(deviceTrust.isWithinBypassWindow(device, policyCalendar, now)).toBe(true);
    });

    test('calendar_day — different UTC day', () => {
      const now = new Date('2026-08-06T01:00:00.000Z');
      const device = { last_verified_at: new Date('2026-08-05T23:00:00.000Z') };
      expect(deviceTrust.isWithinBypassWindow(device, policyCalendar, now)).toBe(false);
    });

    test('returns false when last_verified_at missing', () => {
      expect(deviceTrust.isWithinBypassWindow({}, policyRolling, new Date())).toBe(false);
    });
  });

  describe('deviceHashFromToken', () => {
    test('produces stable SHA-256 hex', () => {
      const h1 = deviceTrust.deviceHashFromToken('abc');
      const h2 = deviceTrust.deviceHashFromToken('abc');
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(64);
    });
  });
});
