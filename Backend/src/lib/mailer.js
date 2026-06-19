/**
 * Password reset / notification emails. Uses SMTP when configured; otherwise logs (dev).
 *
 * SmarterMail and some MTAs reject mail when the client disconnects immediately after DATA 250.
 * We use a pooled transport, configurable timeouts, and a short post-send delay before reuse.
 */
const nodemailer = require('nodemailer');

/** @type {import('nodemailer').Transporter | null} */
let pooledTransport = null;

function smtpPassword() {
  return process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
}

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && smtpPassword());
}

function envFlag(name, defaultTrue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultTrue;
  return raw === 'true' || raw === '1';
}

function smtpTimeoutMs(name, defaultMs) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultMs;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultMs;
}

function smtpInt(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

function smtpPostSendDelayMs() {
  return smtpTimeoutMs('SMTP_POST_SEND_DELAY_MS', 2000);
}

function smtpPoolEnabled() {
  return envFlag('SMTP_POOL', true);
}

function smtpDebugEnabled() {
  return envFlag('SMTP_DEBUG', false);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transportOptions() {
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure =
    process.env.SMTP_SECURE === 'true' ||
    process.env.SMTP_SECURE === '1' ||
    port === 465;
  const rejectUnauthorized =
    process.env.SMTP_REJECT_UNAUTHORIZED !== 'false' && process.env.SMTP_REJECT_UNAUTHORIZED !== '0';
  const requireTLS =
    envFlag('SMTP_REQUIRE_TLS', port === 587 && !secure);

  const options = {
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: smtpPassword(),
    },
    connectionTimeout: smtpTimeoutMs('SMTP_CONNECTION_TIMEOUT_MS', 120000),
    greetingTimeout: smtpTimeoutMs('SMTP_GREETING_TIMEOUT_MS', 120000),
    socketTimeout: smtpTimeoutMs('SMTP_SOCKET_TIMEOUT_MS', 300000),
    tls: {
      rejectUnauthorized,
    },
  };

  if (requireTLS) {
    options.requireTLS = true;
  }

  if (smtpDebugEnabled()) {
    options.logger = true;
    options.debug = true;
  }

  if (smtpPoolEnabled()) {
    options.pool = true;
    options.maxConnections = smtpInt('SMTP_POOL_MAX_CONNECTIONS', 1);
    options.maxMessages = smtpInt('SMTP_POOL_MAX_MESSAGES', 10);
  }

  return options;
}

function createTransport() {
  if (!smtpConfigured()) return null;
  return nodemailer.createTransport(transportOptions());
}

function getTransport() {
  if (!smtpConfigured()) return null;
  if (smtpPoolEnabled()) {
    if (!pooledTransport) {
      pooledTransport = createTransport();
    }
    return pooledTransport;
  }
  return createTransport();
}

/**
 * @param {import('nodemailer').SendMailOptions} mailOptions
 * @returns {Promise<import('nodemailer').SentMessageInfo>}
 */
async function sendViaSmtp(mailOptions) {
  const transport = getTransport();
  if (!transport) {
    throw new Error('SMTP not configured');
  }

  const info = await transport.sendMail(mailOptions);
  const postDelayMs = smtpPostSendDelayMs();
  if (postDelayMs > 0) {
    await delay(postDelayMs);
  }

  if (!smtpPoolEnabled() && typeof transport.close === 'function') {
    transport.close();
  }

  return info;
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
  const info = await sendViaSmtp({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  });
  console.info('[mailer] Password reset email sent via SMTP', info.messageId || '');
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
  const info = await sendViaSmtp({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  });
  console.info('[mailer] Password changed email sent via SMTP', info.messageId || '');
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
  const info = await sendViaSmtp({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  });
  console.info('[mailer] OTP email sent via SMTP', info.messageId || '');
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
  const info = await sendViaSmtp({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  });
  console.info('[mailer] SSO link verification email sent via SMTP', info.messageId || '');
  return { skipped: false };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Close pooled transport (tests / graceful shutdown). */
function closeTransport() {
  if (pooledTransport && typeof pooledTransport.close === 'function') {
    pooledTransport.close();
    pooledTransport = null;
  }
}

module.exports = {
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendOtpEmail,
  sendSsoLinkVerificationEmail,
  smtpConfigured,
  closeTransport,
};
