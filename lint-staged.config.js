const toFrontendPath = (filePath) => filePath.replace(/^frontend[\\/]/, '');
const quote = (value) => `"${value.replaceAll('"', '\\"')}"`;
const joinFiles = (files) => files.map((file) => quote(file)).join(' ');

module.exports = {
  'ops/**/*.{ps1,js,ts,md}': ['npm run ops:guard'],
  'scripts/**/*.{js,ts,ps1,md}': ['npm run ops:guard'],
  'frontend/**/*.{js,ts,vue,scss,css,json,md,yml,yaml}': (files) => {
    const targets = files.map(toFrontendPath);
    if (!targets.length) return [];
    return [`cd frontend && npx prettier --write ${joinFiles(targets)}`];
  },
  'frontend/**/*.{js,ts,vue}': () => [
    'cd frontend && npm run lint:fix',
    'cd frontend && npm run type-check -- --noEmit',
  ],
  'backend/**/*.{js,ts}': [
    'node tools/lint/lint-staged-backend.mjs',
  ],
};
