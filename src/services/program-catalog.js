'use strict';

const PROGRAMS = [
  { id: 'short-fundraising-project-proposal-writing', level: 'Short courses', name: 'Fundraising & Project Proposal Writing', duration: '2 months', tuition: '—' },
  { id: 'short-strategic-plan-development', level: 'Short courses', name: 'Strategic Plan Development', duration: '2 months', tuition: '—' },
  { id: 'short-business-plan-writing', level: 'Short courses', name: 'Business Plan Writing', duration: '2 months', tuition: '—' },
  { id: 'short-communication-report-presentation-skills', level: 'Short courses', name: 'Communication Skills, Report Writing & Presentation Skills', duration: '2 months', tuition: '—' },
  { id: 'short-customer-care-skills', level: 'Short courses', name: 'Customer Care Skills', duration: '2 months', tuition: '—' },
  { id: 'short-marketing-sales', level: 'Short courses', name: 'Marketing & Sales', duration: '2 months', tuition: '—' },
  { id: 'short-financial-management', level: 'Short courses', name: 'Financial Management', duration: '2 months', tuition: '—' },
  { id: 'short-leadership-management', level: 'Short courses', name: 'Leadership & Management', duration: '2 months', tuition: '—' },
  { id: 'short-basic-monitoring-evaluation', level: 'Short courses', name: 'Basic Monitoring & Evaluation', duration: '2 months', tuition: '—' },
  { id: 'short-computerized-accounting-quickbooks', level: 'Short courses', name: 'Computerized Accounting (Quickbooks)', duration: '2 months', tuition: '—' },
  { id: 'short-basic-hotel-catering', level: 'Short courses', name: 'Basic Hotel & Catering', duration: '2 months', tuition: '—' },
  { id: 'diploma-business-administration', level: 'Diploma', name: 'Diploma in Business Administration', duration: '2 years', tuition: '—' },
  { id: 'diploma-accounting-and-finance', level: 'Diploma', name: 'Diploma in Accounting and Finance', duration: '2 years', tuition: '—' },
  { id: 'diploma-human-resource-management', level: 'Diploma', name: 'Diploma in Human Resource Management', duration: '2 years', tuition: '—' },
  { id: 'diploma-procurement-and-logistics-management', level: 'Diploma', name: 'Diploma in Procurement and Logistics Management', duration: '2 years', tuition: '—' },
  { id: 'diploma-public-administration-and-management', level: 'Diploma', name: 'Diploma in Public Administration and Management', duration: '2 years', tuition: '—' },
  { id: 'diploma-project-planning-and-management', level: 'Diploma', name: 'Diploma in Project Planning and Management', duration: '2 years', tuition: '—' },
  { id: 'diploma-hotel-and-hospitality-management', level: 'Diploma', name: 'Diploma in Hotel and Hospitality Management', duration: '2 years', tuition: '—' },
  { id: 'diploma-journalism-and-mass-communication', level: 'Diploma', name: 'Diploma in Journalism and Mass Communication', duration: '2 years', tuition: '—' },
  { id: 'diploma-records-and-information-management', level: 'Diploma', name: 'Diploma in Records and Information Management', duration: '2 years', tuition: '—' },
  { id: 'diploma-secretarial-and-office-management', level: 'Diploma', name: 'Diploma in Secretarial and Office Management', duration: '2 years', tuition: '—' },
  { id: 'diploma-social-work-and-social-administration', level: 'Diploma', name: 'Diploma in Social Work and Social Administration', duration: '2 years', tuition: '—' },
  { id: 'diploma-early-childhood-development', level: 'Diploma', name: 'Diploma in Early Childhood Development', duration: '2 years', tuition: '—' },
  { id: 'certificate-early-childhood-development-and-nursery-teaching', level: 'Certificate', name: 'Certificate in Early Childhood Development & Nursery Teaching', duration: '2 years', tuition: '—' },
  { id: 'national-certificate-accounting-and-finance', level: 'Certificate', name: 'National Certificate in Accounting and Finance', duration: '2 years', tuition: '—' },
  { id: 'national-certificate-hotel-and-institutional-catering', level: 'Certificate', name: 'National Certificate in Hotel & Institutional Catering', duration: '2 years', tuition: '—' },
  { id: 'national-certificate-business-administration', level: 'Certificate', name: 'National Certificate in Business Administration', duration: '2 years', tuition: '—' },
  { id: 'national-certificate-records-and-information-management', level: 'Certificate', name: 'National Certificate in Records & Information Management', duration: '2 years', tuition: '—' },
  { id: 'national-certificate-journalism-and-media-studies', level: 'Certificate', name: 'National Certificate in Journalism and Media Studies', duration: '2 years', tuition: '—' },
  { id: 'national-certificate-social-work-and-social-administration', level: 'Certificate', name: 'National Certificate in Social Work & Social Administration', duration: '2 years', tuition: '—' },
  { id: 'national-certificate-public-administration-and-management', level: 'Certificate', name: 'National Certificate in Public Administration & Management', duration: '2 years', tuition: '—' },
  { id: 'national-certificate-secretarial-and-office-management', level: 'Certificate', name: 'National Certificate in Secretarial and Office Management', duration: '2 years', tuition: '—' },
];

const INTAKES = ['March', 'August'];
const PROGRAMS_BY_ID = new Map(PROGRAMS.map((program) => [program.id, program]));

function getPrograms() {
  return PROGRAMS.map((program) => ({ ...program }));
}

function getProgram(programId) {
  const program = PROGRAMS_BY_ID.get(programId);
  return program ? { ...program } : undefined;
}

function getIntakes() {
  return [...INTAKES];
}

function isIntake(intake) {
  return INTAKES.includes(intake);
}

module.exports = { PROGRAMS, INTAKES, getPrograms, getProgram, getIntakes, isIntake };
