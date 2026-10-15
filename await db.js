await db.run(
  'UPDATE applicants SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = datetime(\'now\') WHERE id = ?',
  [passwordHash, applicantId],
);