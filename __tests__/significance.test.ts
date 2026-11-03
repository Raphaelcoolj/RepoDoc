import {
  classifyFileChanges,
  isIgnoredPath,
  isDependencyManifest,
  getRegenMinSignificantFiles,
} from '../lib/significance';

describe('significance', () => {
  const originalEnv = process.env.REGEN_MIN_SIGNIFICANT_FILES;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REGEN_MIN_SIGNIFICANT_FILES;
    } else {
      process.env.REGEN_MIN_SIGNIFICANT_FILES = originalEnv;
    }
  });

  test('default threshold is 3', () => {
    delete process.env.REGEN_MIN_SIGNIFICANT_FILES;
    expect(getRegenMinSignificantFiles()).toBe(3);
  });

  test('threshold reads env override', () => {
    process.env.REGEN_MIN_SIGNIFICANT_FILES = '5';
    expect(getRegenMinSignificantFiles()).toBe(5);
  });

  test('threshold falls back to 3 on garbage', () => {
    process.env.REGEN_MIN_SIGNIFICANT_FILES = 'not-a-number';
    expect(getRegenMinSignificantFiles()).toBe(3);
  });

  test.each([
    'README.md',
    'docs/guide.mdx',
    'notes.txt',
    'assets/logo.svg',
    'fonts/inter.woff2',
    'dist/bundle.js',
    'build/output.js',
    '.next/server/app.js',
    'node_modules/lodash/index.js',
    'vendor/lib.ts',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'src/app.min.js',
    'LICENSE',
    'LICENSE.md',
    '.gitignore',
    '__snapshots__/app.test.ts.snap',
    'src/component.snap',
  ])('ignores %s', (path) => {
    expect(isIgnoredPath(path)).toBe(true);
  });

  test.each([
    'src/index.ts',
    'package.json',
    'pyproject.toml',
    'go.mod',
    'server/main.go',
  ])('does not ignore %s', (path) => {
    expect(isIgnoredPath(path)).toBe(false);
  });

  test.each([
    'package.json',
    'requirements.txt',
    'go.mod',
    'Cargo.toml',
    'pom.xml',
    'tsconfig.json',
    'tsconfig.base.json',
    'services/api/tsconfig.json',
    'packages/ui/package.json',
    'Dockerfile',
    'docker-compose.yml',
    'pyproject.toml',
    'composer.json',
    'Gemfile',
    'Makefile',
    'next.config.ts',
    'vite.config.js',
  ])('detects manifest %s', (path) => {
    expect(isDependencyManifest(path)).toBe(true);
  });

  test.each(['src/index.ts', 'package-lock.json', 'yarn.lock', 'README.md'])(
    'does not detect manifest %s',
    (path) => {
      expect(isDependencyManifest(path)).toBe(false);
    }
  );

  test('3 non-ignored files is significant at default threshold', () => {
    const result = classifyFileChanges(['a.ts', 'b.ts', 'c.ts']);
    expect(result.significant).toBe(true);
    expect(result.nonIgnoredFiles).toBe(3);
    expect(result.manifestChanged).toBe(false);
  });

  test('2 non-ignored files is insignificant at default threshold', () => {
    const result = classifyFileChanges(['a.ts', 'b.ts']);
    expect(result.significant).toBe(false);
  });

  test('ignored files do not count toward the threshold', () => {
    const result = classifyFileChanges([
      'README.md',
      'CHANGELOG.md',
      'docs/a.md',
      'dist/b.js',
    ]);
    expect(result.significant).toBe(false);
    expect(result.nonIgnoredFiles).toBe(0);
  });

  test('a manifest change alone is significant', () => {
    const result = classifyFileChanges(['package.json']);
    expect(result.significant).toBe(true);
    expect(result.manifestChanged).toBe(true);
  });

  test('manifests inside ignored directories do not count', () => {
    const result = classifyFileChanges(['node_modules/foo/package.json']);
    expect(result.significant).toBe(false);
    expect(result.nonIgnoredFiles).toBe(0);
  });

  test('threshold is respected when overridden', () => {
    process.env.REGEN_MIN_SIGNIFICANT_FILES = '2';
    expect(classifyFileChanges(['a.ts', 'b.ts']).significant).toBe(true);
    expect(classifyFileChanges(['a.ts']).significant).toBe(false);
  });
});
