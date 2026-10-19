'use strict';
const nodemailer = require('nodemailer');
const { escapeHtml } = require('./lib');

let transport = null;
function smtpConfigured() { return Boolean(process.env.SMTP_HOST); }

function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: String(process.env.SMTP_SECURE || (port === 465)).toLowerCase() === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

async function sendMail({ to, subject, text, html }) {
  if (!to) throw new Error('No notification email set');
  if (!smtpConfigured()) {
    console.log(`\n--- EMAIL (SMTP not configured, logging only) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n--- END EMAIL ---\n`);
    return { logged: true };
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  await getTransport().sendMail({ from, to, subject, text, html });
  return { sent: true };
}

function buildChangeEmail({ watch, diff, at, appUrl }) {
  const name = watch.label || new URL(watch.url).hostname;
  const when = new Date(at).toUTCString();
  const subject = `Update detected: ${name}`;
  const linkLines = diff.newLinks.map((l) => `- ${l.text || l.href}\n  ${l.href}`);
  const textLines = diff.addedText.map((t) => `- ${t}`);
  const text = [
    `A change was detected on ${name}`,
    `URL: ${watch.url}`,
    `Time: ${when}`,
    '',
    diff.newLinks.length ? `New links:\n${linkLines.join('\n')}\n` : '',
    diff.addedText.length ? `Added text:\n${textLines.join('\n')}\n` : '',
    !diff.newLinks.length && !diff.addedText.length ? 'The page content changed, but no new links or text lines could be isolated (content may have been removed or reordered).\n' : '',
  ].filter((x) => x !== '').join('\n');

  const li = (s) => `<li style="margin:0 0 6px">${s}</li>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f4;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1917">
<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:10px;padding:24px">
<h2 style="margin:0 0 4px;font-size:18px">Update detected</h2>
<p style="margin:0 0 16px;color:#57534e">${escapeHtml(name)}</p>
<p style="margin:0 0 4px;font-size:14px"><a href="${escapeHtml(watch.url)}" style="color:#2563eb">${escapeHtml(watch.url)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#78716c">${escapeHtml(when)}</p>
${diff.newLinks.length ? `<h3 style="font-size:14px;margin:16px 0 8px">New links</h3><ul style="padding-left:18px;margin:0;font-size:14px">${diff.newLinks.map((l) => li(`<a href="${escapeHtml(l.href)}" style="color:#2563eb">${escapeHtml(l.text || l.href)}</a>`)).join('')}</ul>` : ''}
${diff.addedText.length ? `<h3 style="font-size:14px;margin:16px 0 8px">Added text</h3><ul style="padding-left:18px;margin:0;font-size:14px">${diff.addedText.map((t) => li(escapeHtml(t))).join('')}</ul>` : ''}
${!diff.newLinks.length && !diff.addedText.length ? '<p style="font-size:14px;color:#57534e">The page content changed, but no new links or text lines could be isolated (content may have been removed or reordered).</p>' : ''}
<p style="margin:24px 0 0;font-size:12px;color:#a8a29e">Sent by News Scanner${appUrl ? ` - ${escapeHtml(appUrl)}` : ''}</p>
</div></body></html>`;
  return { subject, text, html };
}

module.exports = { sendMail, buildChangeEmail, smtpConfigured };
