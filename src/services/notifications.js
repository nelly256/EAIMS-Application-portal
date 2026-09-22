const nodemailer = require('nodemailer');
const config = require('../config');
const { normalizePhone } = require('../validation');

let transporter;

function getTransporter() {
  if (!config.smtp.host) {
    if (config.nodeEnv === 'development') {
      return nodemailer.createTransport({
        name: 'eaims-dev',
        send(mail, callback) {
          const data = mail.data || {};
          const logEntry = {
            type: 'email',
            from: data.from,
            to: data.to,
            subject: data.subject,
            text: data.text,
            html: data.html,
          };
          console.log('[DEV EMAIL]', JSON.stringify(logEntry, null, 2));
          callback(null, { messageId: `dev-${Date.now()}` });
        },
      });
    }
    return null;
  }
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
    return { sent: false, reason: 'SMTP_ERROR', error: error.message };
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
    return { sent: false, reason, error: error.message };
  }
  if (response.status >= 200 && response.status < 300) {
    return { sent: true, status: response.status };
  }
  let errorDetail = '';
  try {
    const responseBody = await response.text();
    errorDetail = responseBody;
  } catch (bodyError) {
    errorDetail = `Unable to read error response: ${bodyError.message}`;
  }
  if (config.nodeEnv === 'development') {
    console.error('[SMS DEBUG]', {
      provider: config.sms.provider,
      apiUrl: config.sms.apiUrl,
      status: response.status,
      responseBody: errorDetail,
      to,
      username: config.sms.username,
    });
  }
  return { sent: false, reason: 'SMS_API_ERROR', status: response.status, error: errorDetail };
}

async function sendVerification(applicant, code) {
  const expiryMinutes = config.otpExpiryMinutes;
  const surname = applicant.surname || '';
  const otherNames = applicant.otherNames || applicant.other_names || '';
  const recipientName = otherNames ? `${surname} ${otherNames}`.trim() : (surname || 'there');
  const plainMessage = `Dear ${recipientName},\n\nEAIMS verification code: ${code}. Valid for ${expiryMinutes} minutes. Do not share this code with anyone.`;
  const htmlMessage = `<p>Dear ${recipientName},</p><p>Your EAIMS application portal verification code is:</p><p style="font-size:2em; font-weight:bold; letter-spacing:2px; padding:8px 16px; background:#f0f0f0; display:inline-block;">${code}</p><p>This code is valid for <strong>${expiryMinutes} minutes</strong>. Do not share this code with anyone.</p><p>If you did not request this, please ignore this email.</p><p>East African Institute for Management Science</p>`;
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
  const plainMessage = `Reset your EAIMS password using this secure link: ${resetUrl}. The link expires in 30 minutes.`;
  const htmlMessage = `<p>Reset your EAIMS password using this secure link:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>The link expires in 30 minutes.</p>`;
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
    results.error = error.message;
    if (process.env.NODE_ENV === 'development') console.error('[SMTP TEST]', error);
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
    results.error = error.message;
    if (process.env.NODE_ENV === 'development') console.error('[SMTP TEST]', error);
  }
  return results;
}

module.exports = { sendEmail, sendSms, sendVerification, sendPasswordReset, testSmtpConnection };
