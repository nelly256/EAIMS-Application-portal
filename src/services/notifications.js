const nodemailer = require('nodemailer');
const config = require('../config');
const { normalizePhone } = require('../validation');

let transporter;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function getTransporter() {
  if (!config.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

async function sendEmail({ to, subject, text, html }) {
  const mailer = getTransporter();
  if (!mailer) return { sent: false, reason: 'SMTP_NOT_CONFIGURED' };
  try {
    const info = await mailer.sendMail({ from: config.smtp.from, to, subject, text, html });
    return { sent: true, messageId: info.messageId };
  } catch (error) {
    return { sent: false, reason: 'SMTP_ERROR' };
  }
}

async function withTimeout(fn, ms) {
  if (!ms || ms <= 0) return fn(null);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('TIMEOUT')))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function sendSms({ to, message }) {
  if (!config.sms.apiUrl || !config.sms.apiKey) return { sent: false, reason: 'SMS_NOT_CONFIGURED' };
  let headers;
  let body;
  if (config.sms.provider === 'africasTalking') {
    headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${config.sms.username}:${config.sms.apiKey}`).toString('base64'),
    };
    const params = new URLSearchParams({ to, message });
    if (config.sms.username) params.append('username', config.sms.username);
    if (config.sms.from) params.append('from', config.sms.from);
    body = params.toString();
  } else {
    const payload = { to, message };
    if (config.sms.from) payload.from = config.sms.from;
    headers = {
      Authorization: `Bearer ${config.sms.apiKey}`,
      'Content-Type': 'application/json',
    };
    body = JSON.stringify(payload);
  }
  let response;
  try {
    response = await withTimeout((signal) => fetch(config.sms.apiUrl, {
      method: 'POST',
      headers,
      body,
      signal,
    }), config.sms.timeoutMs);
  } catch (error) {
    const reason = error.name === 'AbortError' || error.message === 'TIMEOUT' ? 'SMS_TIMEOUT' : 'SMS_NETWORK_ERROR';
    return { sent: false, reason };
  }
  if (response.status >= 200 && response.status < 300) {
    return { sent: true, status: response.status };
  }
  if (config.nodeEnv === 'development') {
    console.error('[SMS DEBUG] Provider request failed.', {
      provider: config.sms.provider,
      status: response.status,
    });
  }
  return { sent: false, reason: 'SMS_API_ERROR', status: response.status };
}

async function sendVerification(applicant, code) {
  const expiryMinutes = config.otpExpiryMinutes;
  const surname = applicant.surname || '';
  const otherNames = applicant.otherNames || applicant.other_names || '';
  const recipientName = otherNames ? `${surname} ${otherNames}`.trim() : (surname || 'there');
  const safeRecipientName = escapeHtml(recipientName);
  const plainMessage = `Dear ${recipientName},\n\nEAIMS verification code: ${code}. Valid for ${expiryMinutes} minutes. Do not share this code with anyone.`;
  const htmlMessage = `<p>Dear ${safeRecipientName},</p><p>Your EAIMS application portal verification code is:</p><p style="font-size:2em; font-weight:bold; letter-spacing:2px; padding:8px 16px; background:#f0f0f0; display:inline-block;">${code}</p><p>This code is valid for <strong>${expiryMinutes} minutes</strong>. Do not share this code with anyone.</p><p>If you did not request this, please ignore this email.</p><p>East African Institute for Management Science</p>`;
  const smsMessage = `EAIMS verification code: ${code}. Valid for ${expiryMinutes} minutes. Do not share.`;
  const phone = applicant.phone || '';
  const phoneCountryCode = applicant.phoneCountryCode || applicant.phone_country_code || '+256';
  const normalizedPhone = phone ? normalizePhone(phone, phoneCountryCode) : '';
  const [email, sms] = await Promise.allSettled([
    applicant.email ? sendEmail({
      to: applicant.email,
      subject: 'Verify your EAIMS application account',
      text: plainMessage,
      html: htmlMessage,
    }) : Promise.resolve({ sent: false, reason: 'EMAIL_NOT_AVAILABLE' }),
    normalizedPhone ? sendSms({ to: normalizedPhone, message: smsMessage }) : Promise.resolve({ sent: false, reason: 'PHONE_NOT_AVAILABLE' }),
  ]);
  return {
    email: email.status === 'fulfilled' ? email.value : { sent: false, reason: 'EMAIL_DELIVERY_FAILED' },
    sms: sms.status === 'fulfilled' ? sms.value : { sent: false, reason: 'SMS_DELIVERY_FAILED' },
  };
}

async function sendPasswordReset(applicant, resetUrl) {
  const safeResetUrl = escapeHtml(resetUrl);
  const plainMessage = `Reset your EAIMS password using this secure link: ${resetUrl}. The link expires in 30 minutes.`;
  const htmlMessage = `<p>Reset your EAIMS password using this secure link:</p><p><a href="${safeResetUrl}">${safeResetUrl}</a></p><p>The link expires in 30 minutes.</p>`;
  const smsMessage = `Reset your EAIMS password using this secure link: ${resetUrl}. The link expires in 30 minutes.`;
  const phone = applicant.phone || '';
  const phoneCountryCode = applicant.phoneCountryCode || applicant.phone_country_code || '+256';
  const normalizedPhone = phone ? normalizePhone(phone, phoneCountryCode) : '';
  const [email, sms] = await Promise.allSettled([
    applicant.email ? sendEmail({
      to: applicant.email,
      subject: 'Reset your EAIMS password',
      text: plainMessage,
      html: htmlMessage,
    }) : Promise.resolve({ sent: false, reason: 'EMAIL_NOT_AVAILABLE' }),
    normalizedPhone ? sendSms({ to: normalizedPhone, message: smsMessage }) : Promise.resolve({ sent: false, reason: 'PHONE_NOT_AVAILABLE' }),
  ]);
  return {
    email: email.status === 'fulfilled' ? email.value : { sent: false, reason: 'EMAIL_DELIVERY_FAILED' },
    sms: sms.status === 'fulfilled' ? sms.value : { sent: false, reason: 'SMS_DELIVERY_FAILED' },
  };
}

async function testSmtpConnection(testEmail) {
  const mailer = getTransporter();
  if (!mailer) {
    if (!config.smtp.host) return { configured: false, message: 'SMTP_HOST is not set — no email delivery configured.' };
    return { configured: false, message: 'SMTP transport not available.' };
  }
  const results = { configured: true, host: config.smtp.host, port: config.smtp.port };
  try {
    await new Promise((resolve, reject) => {
      mailer.verify((error) => (error ? reject(error) : resolve()));
    });
    results.smtpConnection = 'SMTP connection successful';
    results.smtpAuth = 'SMTP authentication successful';
  } catch (error) {
    results.smtpConnection = 'SMTP connection failed';
    results.smtpAuth = 'SMTP authentication failed';
    return results;
  }
  if (!testEmail) {
    results.smtpSend = 'Skipped (no test email provided)';
    return results;
  }
  try {
    const info = await mailer.sendMail({
      from: config.smtp.from,
      to: testEmail,
      subject: 'EAIMS email delivery test',
      text: 'This is a test email from the EAIMS Application Portal. If you received this, email delivery is working.',
    });
    results.smtpSend = 'Test email accepted and sent';
    results.messageId = info.messageId;
  } catch (error) {
    results.smtpSend = 'Test email failed';
  }
  return results;
}

module.exports = { sendEmail, sendSms, sendVerification, sendPasswordReset, testSmtpConnection };
