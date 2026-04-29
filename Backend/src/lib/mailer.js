/**
 * Password reset / notification emails. Uses SMTP when configured; otherwise logs (dev).
 */
const nodemailer = require('nodemailer');

function smtpPassword() {
  return process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
}

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && smtpPassword());
}

function createTransport() {
  if (!smtpConfigured()) return null;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure =
    process.env.SMTP_SECURE === 'true' ||
    process.env.SMTP_SECURE === '1' ||
    port === 465;
  const rejectUnauthorized =
    process.env.SMTP_REJECT_UNAUTHORIZED !== 'false' && process.env.SMTP_REJECT_UNAUTHORIZED !== '0';
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: smtpPassword(),
    },
    tls: {
      rejectUnauthorized,
    },
  });
}

const fromAddress = () =>
  process.env.MAIL_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@localhost';

/**
 * @param {{ to: string, resetUrl: string }} opts
 */
async function sendPasswordResetEmail({ to, resetUrl }) {
  const subject = 'Reset your Downstream Hub password';
  const text = `You requested a password reset. Open this link to choose a new password (expires soon):\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`;
  const html = `<p>You requested a password reset.</p><p><a href="${escapeHtml(resetUrl)}">Reset your password</a></p><p>If you did not request this, you can ignore this email.</p>`;

  if (!smtpConfigured()) {
    console.info('[mailer] SMTP not configured; password reset link (dev only):');
    console.info(resetUrl);
    return { skipped: true };
  }
  const transport = createTransport();
  await transport.sendMail({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  });
  console.info('[mailer] Password reset email sent via SMTP');
  return { skipped: false };
}

/**
 * @param {{ to: string }} opts
 */
async function sendPasswordChangedEmail({ to }) {
  const subject = 'Your Downstream Hub password was changed';
  const text =
    'Your password was changed. If you did not make this change, contact your administrator immediately.';
  const html = `<p>Your password was changed.</p><p>If you did not make this change, contact your administrator immediately.</p>`;

  if (!smtpConfigured()) {
    console.info('[mailer] SMTP not configured; would send password-changed notice to', to);
    return { skipped: true };
  }
  const transport = createTransport();
  await transport.sendMail({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  });
  return { skipped: false };
}

/**
 * @param {{ to: string, otp: string, ttlSeconds: number }} opts
 */
async function sendOtpEmail({ to, otp, ttlSeconds }) {
  const subject = 'Your Downstream Hub verification code';
  const text = `Your verification code is ${otp}. It expires in ${Math.max(1, Math.floor(ttlSeconds / 60))} minute(s).`;
  const html = `<p>Your verification code is <strong>${escapeHtml(otp)}</strong>.</p><p>It expires in ${Math.max(1, Math.floor(ttlSeconds / 60))} minute(s).</p>`;

  if (!smtpConfigured()) {
    console.info('[mailer] SMTP not configured; MFA OTP (dev only):', otp);
    return { skipped: true };
  }
  const transport = createTransport();
  await transport.sendMail({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  });
  return { skipped: false };
}

/**
 * @param {{ to: string, verifyUrl: string }} opts
 */
async function sendSsoLinkVerificationEmail({ to, verifyUrl }) {
  const subject = 'Confirm SSO account linking in Downstream Hub';
  const text = `To complete account linking, open this verification link:\n\n${verifyUrl}\n\nIf you did not request this action, ignore this email.`;
  const html = `<p>To complete account linking, verify your email:</p><p><a href="${escapeHtml(verifyUrl)}">Confirm SSO linking</a></p><p>If you did not request this action, ignore this email.</p>`;
  if (!smtpConfigured()) {
    console.info('[mailer] SMTP not configured; SSO link verification URL (dev only):');
    console.info(verifyUrl);
    return { skipped: true };
  }
  const transport = createTransport();
  await transport.sendMail({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  });
  return { skipped: false };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendOtpEmail,
  sendSsoLinkVerificationEmail,
  smtpConfigured,
};
