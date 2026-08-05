/**
 * Branded HTML + plain-text templates for transactional Hub emails.
 * Table-based layout for Gmail/Outlook; inline CSS only.
 */

const BRAND = {
  primary: '#C43A31',
  primaryDeep: '#9E2C25',
  textCharcoal: '#2B2B2B',
  textSteel: '#6B6B6B',
  bgLight: '#F4F4F4',
  bgWhite: '#FFFFFF',
  border: '#E0E0E0',
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function publicAppBase() {
  return (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
}

function publicAppLogoUrl() {
  const base = publicAppBase();
  if (!base || base.includes('localhost')) return null;
  return `${base}/logo.png`;
}

function normalizeLines(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [String(value)];
}

/** Outlook VML roundrect width — fixed 220px clipped longer labels like "Complete sign-in". */
function buttonWidthForLabel(label) {
  const len = String(label).length;
  return Math.max(240, Math.min(360, len * 14 + 48));
}

function renderBulletproofButton(label, url) {
  const safeLabel = escapeHtml(label);
  const safeUrl = escapeHtml(url);
  const buttonWidth = buttonWidthForLabel(label);
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:24px auto;">
  <tr>
    <td align="center" bgcolor="${BRAND.primary}" style="border-radius:8px;background-color:${BRAND.primary};">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
        href="${safeUrl}" style="height:48px;v-text-anchor:middle;width:${buttonWidth}px;" arcsize="12%" stroke="f" fillcolor="${BRAND.primary}">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${safeLabel}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${safeUrl}" target="_blank" rel="noopener noreferrer"
        style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;background-color:${BRAND.primary};white-space:nowrap;mso-hide:all;">
        ${safeLabel}
      </a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;
}

function renderCodeBlock(code) {
  const safeCode = escapeHtml(String(code).replace(/\s/g, ''));
  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
  <tr>
    <td align="center" style="padding:20px 24px;background-color:${BRAND.bgLight};border:1px dashed ${BRAND.border};border-radius:8px;">
      <span style="font-family:Consolas,Monaco,'Courier New',monospace;font-size:28px;font-weight:700;letter-spacing:0.35em;color:${BRAND.textCharcoal};">${safeCode}</span>
    </td>
  </tr>
</table>`;
}

/**
 * @param {{
 *   preheader?: string,
 *   heading: string,
 *   intro?: string | string[],
 *   note?: string,
 *   cta?: { label: string, url: string },
 *   code?: string,
 *   alertHtml?: string,
 *   footerNote?: string,
 * }} opts
 * @returns {{ html: string, text: string }}
 */
function buildBrandedEmail(opts) {
  const introLines = normalizeLines(opts.intro);
  const logoUrl = publicAppLogoUrl();
  const footerNote =
    opts.footerNote ||
    'If you did not request this, you can ignore this email.';

  const introHtml = introLines
    .map(
      (line) =>
        `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.textCharcoal};">${escapeHtml(line)}</p>`
    )
    .join('');

  const noteHtml = opts.note
    ? `<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${BRAND.textSteel};">${escapeHtml(opts.note)}</p>`
    : '';

  const ctaHtml = opts.cta ? renderBulletproofButton(opts.cta.label, opts.cta.url) : '';
  const codeHtml = opts.code ? renderCodeBlock(opts.code) : '';
  const alertHtml = opts.alertHtml || '';

  const urlFallbackHtml =
    opts.cta?.url
      ? `<p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${BRAND.textSteel};word-break:break-all;text-align:center;">
           Or copy this link:<br><a href="${escapeHtml(opts.cta.url)}" style="color:${BRAND.primary};">${escapeHtml(opts.cta.url)}</a>
         </p>`
      : '';

  const logoHtml = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="40" height="40" alt="" style="display:block;border:0;outline:none;text-decoration:none;border-radius:8px;" />`
    : `<div style="width:40px;height:40px;border-radius:8px;background-color:${BRAND.primary};"></div>`;

  const preheader = opts.preheader || introLines[0] || opts.heading;
  const preheaderHtml = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}</div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bgLight};">
  ${preheaderHtml}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${BRAND.bgLight};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:${BRAND.bgWhite};border:1px solid ${BRAND.border};border-radius:10px;overflow:hidden;">
          <tr>
            <td style="padding:20px 24px;background-color:${BRAND.bgLight};border-bottom:1px solid ${BRAND.border};">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding-right:12px;vertical-align:middle;">${logoHtml}</td>
                  <td style="vertical-align:middle;">
                    <span style="font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:600;color:${BRAND.textCharcoal};">Downstream Hub</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px;">
              <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:600;line-height:1.3;color:${BRAND.textCharcoal};">${escapeHtml(opts.heading)}</h1>
              ${introHtml}
              ${noteHtml}
              ${alertHtml}
              ${ctaHtml}
              ${codeHtml}
              ${urlFallbackHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 24px;background-color:${BRAND.bgLight};border-top:1px solid ${BRAND.border};">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${BRAND.textSteel};">${escapeHtml(footerNote)}</p>
              <p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${BRAND.textSteel};">Do not reply to this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textParts = [opts.heading, '', ...introLines];
  if (opts.note) textParts.push('', opts.note);
  if (opts.alertHtml) {
    textParts.push('', opts.alertHtml.replace(/<[^>]+>/g, ''));
  }
  if (opts.cta?.url) {
    textParts.push('', `${opts.cta.label}:`, opts.cta.url);
  }
  if (opts.code) {
    textParts.push('', `Verification code: ${opts.code}`);
  }
  textParts.push('', footerNote, '', 'Do not reply to this email.');
  const text = textParts.join('\n');

  return { html, text };
}

module.exports = {
  BRAND,
  escapeHtml,
  publicAppBase,
  publicAppLogoUrl,
  buttonWidthForLabel,
  buildBrandedEmail,
};
