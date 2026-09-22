const validator = require('validator');

const COUNTRY_CODES = [
  { code: '+256', name: 'Uganda' },
  { code: '+254', name: 'Kenya' },
  { code: '+255', name: 'Tanzania' },
  { code: '+250', name: 'Rwanda' },
  { code: '+257', name: 'Burundi' },
  { code: '+211', name: 'South Sudan' },
  { code: '+243', name: 'Democratic Republic of the Congo' },
  { code: '+251', name: 'Ethiopia' },
  { code: '+27', name: 'South Africa' },
  { code: '+44', name: 'United Kingdom' },
  { code: '+1', name: 'United States / Canada' },
  { code: '+91', name: 'India' },
  { code: '+86', name: 'China' },
  { code: '+971', name: 'United Arab Emirates' },
];

const NATIONALITIES = [
  'Ugandan', 'Kenyan', 'Tanzanian', 'Rwandan', 'Burundian', 'South Sudanese',
  'Congolese', 'Ethiopian', 'Eritrean', 'Somali', 'Sudanese', 'Burmese',
  'American', 'Canadian', 'British', 'Irish', 'Australian', 'New Zealander',
  'Indian', 'Pakistani', 'Bangladeshi', 'Sri Lankan', 'Nepalese', 'Chinese',
  'Japanese', 'Korean', 'Singaporean', 'Malaysian', 'Indonesian', 'Thai',
  'Vietnamese', 'Filipino', 'South African', 'Zambian', 'Zimbabwean',
  'Botswanan', 'Namibian', 'Ghanaian', 'Nigerian', 'Senegalese', 'Cameroonian',
  'Kenyan', 'Egyptian', 'Moroccan', 'Tunisian', 'French', 'German', 'Italian',
  'Spanish', 'Portuguese', 'Dutch', 'Belgian', 'Swiss', 'Swedish', 'Norwegian',
  'Danish', 'Finnish', 'Polish', 'Austrian', 'Greek', 'Turkish', 'Brazilian',
  'Argentinian', 'Chilean', 'Colombian', 'Mexican', 'Peruvian', 'Venezuelan',
  'Other',
];

const NAME_PATTERN = /^[\p{L}][\p{L}\s.'-]*$/u;
const MAX_NAME_LENGTH = 80;

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function normalizePhone(value, countryCode = '+256') {
  const code = String(countryCode || '+256').replace(/\D/g, '');
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith(code)) digits = digits.slice(code.length);
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!code || !digits) return '';
  return `+${code}${digits}`;
}

function parsePhoneIdentifier(value) {
  const raw = clean(value);
  if (!raw) return '';
  if (raw.startsWith('+')) {
    const country = [...COUNTRY_CODES]
      .sort((a, b) => b.code.length - a.code.length)
      .find((item) => raw.startsWith(item.code));
    if (!country) return '';
    let nationalNumber = raw.slice(country.code.length).replace(/\D/g, '');
    if (nationalNumber.startsWith('0')) nationalNumber = nationalNumber.slice(1);
    return nationalNumber.length >= 7 && nationalNumber.length <= 15
      ? `${country.code}${nationalNumber}`
      : '';
  }
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length < 7 || digits.length > 15) return '';
  return `+256${digits}`;
}

function normalizeIdentifier(value) {
  const raw = clean(value);
  if (!raw) return { type: '', value: '' };
  if (raw.includes('@')) {
    const email = normalizeEmail(raw);
    return validator.isEmail(email) ? { type: 'email', value: email } : { type: '', value: '' };
  }
  const phone = parsePhoneIdentifier(raw);
  return phone ? { type: 'phone', value: phone } : { type: '', value: '' };
}

function validName(value) {
  const name = clean(value);
  return name.length >= 2 && name.length <= MAX_NAME_LENGTH && NAME_PATTERN.test(name);
}

function validDate(value) {
  const date = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return false;
  const today = new Date();
  const minimum = new Date('1900-01-01T00:00:00.000Z');
  const age = today.getUTCFullYear() - parsed.getUTCFullYear();
  const hasBirthdayThisYear = today.getUTCMonth() > parsed.getUTCMonth()
    || (today.getUTCMonth() === parsed.getUTCMonth() && today.getUTCDate() >= parsed.getUTCDate());
  return parsed >= minimum && parsed.getTime() <= Date.now() && (age > 16 || (age === 16 && hasBirthdayThisYear));
}

function validateRegistration(body) {
  const errors = {};
  const surname = clean(body.surname);
  const otherNames = clean(body.otherNames || body.other_names);
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phoneNumber || body.phone, body.phoneCountryCode || body.phone_country_code || '+256');
  const nationality = clean(body.nationality);
  const dateOfBirth = clean(body.dateOfBirth || body.date_of_birth);
  const sex = clean(body.sex).toUpperCase();
  const password = String(body.password || '');
  const confirmPassword = String(body.confirmPassword || body.confirm_password || '');

  if (!validName(surname)) errors.surname = 'Enter your surname as it appears on your academic documents.';
  if (!validName(otherNames)) errors.otherNames = 'Enter your other names as they appear on your academic documents.';
  if (!validator.isEmail(email)) errors.email = 'Enter a valid email address.';
  if (!phone || !/^\+\d{8,16}$/.test(phone)) errors.phoneNumber = 'Enter a valid phone number.';
  if (!COUNTRY_CODES.some((country) => `+${country.code.replace('+', '')}` === `+${String(body.phoneCountryCode || body.phone_country_code || '+256').replace('+', '')}`)) {
    errors.phoneCountryCode = 'Pick a valid country code.';
  }
  if (!NATIONALITIES.includes(nationality)) errors.nationality = 'Select your nationality.';
  if (!validDate(dateOfBirth)) errors.dateOfBirth = 'Enter a valid date of birth. Applicants must be at least 16 years old.';
  if (!['MALE', 'FEMALE'].includes(sex)) errors.sex = 'Select your sex.';
  if (password.length < 8 || password.length > 128) errors.password = 'Password must be between 8 and 128 characters.';
  if (confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.';

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data: {
      surname,
      otherNames,
      email,
      phone,
      phoneCountryCode: `+${String(body.phoneCountryCode || body.phone_country_code || '256').replace('+', '')}`,
      nationality,
      dateOfBirth,
      sex,
      password,
    },
  };
}

function validateLogin(body) {
  const errors = {};
  const identifier = normalizeIdentifier(body.identifier || body.email || body.phone);
  const password = String(body.password || '');
  if (!identifier.value) errors.identifier = 'Enter a valid email address or phone number.';
  if (!password) errors.password = 'Enter your password.';
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data: { identifier, password },
  };
}

function validateOtp(body) {
  const code = clean(body.code);
  const errors = {};
  if (!/^\d{6}$/.test(code)) errors.code = 'Enter the 6-digit verification code.';
  return { valid: Object.keys(errors).length === 0, errors, data: { code } };
}

function validatePasswordReset(body) {
  const errors = {};
  const password = String(body.password || '');
  const confirmPassword = String(body.confirmPassword || '');
  if (password.length < 8 || password.length > 128) errors.password = 'Password must be between 8 and 128 characters.';
  if (confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.';
  return { valid: Object.keys(errors).length === 0, errors, data: { password } };
}

module.exports = {
  COUNTRY_CODES,
  NATIONALITIES,
  clean,
  normalizeEmail,
  normalizePhone,
  parsePhoneIdentifier,
  normalizeIdentifier,
  validateRegistration,
  validateLogin,
  validateOtp,
  validatePasswordReset,
};
