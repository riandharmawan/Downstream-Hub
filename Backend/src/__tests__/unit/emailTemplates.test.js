/**
 * Unit tests for branded transactional email templates.
 */
const {
  buildBrandedEmail,
  escapeHtml,
  BRAND,
} = require('../../lib/emailTemplates');

describe('emailTemplates', () => {
  const originalPublicAppUrl = process.env.PUBLIC_APP_URL;

  afterEach(() => {
    if (originalPublicAppUrl === undefined) {
      delete process.env.PUBLIC_APP_URL;
    } else {
      process.env.PUBLIC_APP_URL = originalPublicAppUrl;
    }
  });

  describe('escapeHtml', () => {
    test('escapes HTML special characters', () => {
      expect(escapeHtml('<script>"x"&</script>')).toBe('&lt;script&gt;&quot;x&quot;&amp;&lt;/script&gt;');
    });
  });

  describe('buildBrandedEmail', () => {
    test('CTA template includes bulletproof button and brand color', () => {
      process.env.PUBLIC_APP_URL = 'http://test-dwshub.kpndomain.com';
      const { html, text } = buildBrandedEmail({
        heading: 'Complete your sign-in',
        intro: 'Click the button below to continue.',
        note: 'This link expires in 15 minutes.',
        cta: { label: 'Complete sign-in', url: 'http://test-dwshub.kpndomain.com/magic-link-login?token=abc' },
      });

      expect(html).toContain(BRAND.primary);
      expect(html).toContain('Complete sign-in');
      expect(html).toContain('magic-link-login?token=abc');
      expect(html).toContain('/logo.png');
      expect(html).toContain('v:roundrect');
      expect(text).toContain('Complete sign-in');
      expect(text).toContain('magic-link-login?token=abc');
    });

    test('escapes malicious URL in HTML', () => {
      const evilUrl = 'http://example.com?q=<script>alert(1)</script>';
      const { html } = buildBrandedEmail({
        heading: 'Reset your password',
        cta: { label: 'Reset password', url: evilUrl },
      });

      expect(html).not.toContain('<script>');
      expect(html).toContain(escapeHtml(evilUrl));
    });

    test('OTP template renders code block without CTA button', () => {
      const { html, text } = buildBrandedEmail({
        heading: 'Verification code',
        intro: 'Enter this one-time code.',
        code: '482916',
        note: 'Expires in 5 minutes.',
      });

      expect(html).toContain('482916');
      expect(html).not.toContain('v:roundrect');
      expect(text).toContain('Verification code: 482916');
    });

    test('alert template has no CTA link', () => {
      const { html, text } = buildBrandedEmail({
        heading: 'Password updated',
        intro: 'Your password was changed successfully.',
        alertHtml:
          '<p style="margin:0;">If you did not make this change, contact your administrator immediately.</p>',
        footerNote: 'This is an automated security notice.',
      });

      expect(html).not.toContain('v:roundrect');
      expect(html).toContain('Password updated');
      expect(text).toContain('automated security notice');
      expect(text).not.toMatch(/https?:\/\//);
    });
  });
});
