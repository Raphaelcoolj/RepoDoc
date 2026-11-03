export const IGNORED_PATH_PATTERNS: RegExp[] = [
  /(^|\/)(dist|build|\.next|node_modules|coverage|vendor)\//,
  /\.(md|mdx|markdown|txt)$/i,
  /\.(png|jpe?g|gif|svg|webp|ico|bmp|avif|heic)$/i,
  /\.(woff2?|ttf|otf|eot|sfnt)$/i,
  /\.(mp3|mp4|wav|ogg|webm|mov|avi|mkv|flac)$/i,
  /\.(mp4v|m4v|ogv)$/i,
  /\.min\.[a-z0-9]+$/i,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|npm-shrinkwrap\.json)$/i,
  /(^|\/)(composer\.lock|poetry\.lock|Pipfile\.lock|Cargo\.lock|Gemfile\.lock|go\.sum)$/i,
  /(^|\/)(LICENSE|LICENCE|COPYING|NOTICE)(\..*)?$/i,
  /(^|\/)\.gitignore$/i,
  /(^|\/)(__snapshots__|snapshots)\//,
  /\.(snap|snapshot)$/i,
];

export const MANIFEST_BASENAMES: ReadonlySet<string> = new Set([
  'package.json',
  'go.mod',
  'cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'requirements.txt',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'pipfile',
  'composer.json',
  'gemfile',
  'mix.exs',
  'pubspec.yaml',
  'cmakelists.txt',
  'makefile',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'tsconfig.json',
  'jsconfig.json',
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'webpack.config.js',
  'webpack.config.ts',
  'nuxt.config.ts',
  'nuxt.config.js',
  'svelte.config.js',
  'tailwind.config.js',
  'tailwind.config.ts',
  'turbo.json',
  'nx.json',
  'lerna.json',
]);

const MANIFEST_BASENAME_PATTERNS: RegExp[] = [
  /^tsconfig(\..+)?\.json$/i,
  /^jsconfig(\..+)?\.json$/i,
  /^requirements.*\.txt$/i,
  /^pom\.xml$/i,
  /^dockerfile(\..+)?$/i,
  /^docker-compose\..+\.ya?ml$/i,
];

export function getRegenMinSignificantFiles(): number {
  const raw = process.env.REGEN_MIN_SIGNIFICANT_FILES;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

export function isIgnoredPath(filePath: string): boolean {
  return IGNORED_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function isDependencyManifest(filePath: string): boolean {
  const basename = filePath.split('/').pop() ?? '';
  if (MANIFEST_BASENAMES.has(basename.toLowerCase())) return true;
  return MANIFEST_BASENAME_PATTERNS.some((pattern) => pattern.test(basename));
}

export interface FileChangeClassification {
  significant: boolean;
  nonIgnoredFiles: number;
  manifestChanged: boolean;
}

export function classifyFileChanges(files: string[]): FileChangeClassification {
  const nonIgnored = files.filter((file) => !isIgnoredPath(file));
  const manifestChanged = nonIgnored.some((file) => isDependencyManifest(file));
  const significant =
    manifestChanged || nonIgnored.length >= getRegenMinSignificantFiles();
  return { significant, nonIgnoredFiles: nonIgnored.length, manifestChanged };
}
