function resolveJwtSecret(): string {
  const activeIndex = process.env.JWT_SECRET_ACTIVE_INDEX || '1';
  const secret1 = process.env.JWT_SECRET1;
  const secret2 = process.env.JWT_SECRET2;
  const isTest = process.env.NODE_ENV === 'test';
  const configuredSecret =
    activeIndex === '2' ? secret2 : secret1 || process.env.JWT_SECRET;
  const secret = configuredSecret || (isTest ? 'test_jwt_secret' : undefined);

  if (!secret) {
    throw new Error(
      'JWT_SECRET is not defined. Set JWT_SECRET1/2 (+JWT_SECRET_ACTIVE_INDEX) or JWT_SECRET',
    );
  }

  return secret;
}

export const jwtConstants = {
  get secret() {
    return resolveJwtSecret();
  },
};
