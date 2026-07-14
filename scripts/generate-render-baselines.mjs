import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const baselineDirectory = join(projectRoot, 'tests', 'render', 'baselines')
const argumentsList = process.argv.slice(2)

if (argumentsList.includes('--seed-linux-from-windows')) {
  await mkdir(baselineDirectory, { recursive: true })
  const windowsFiles = (await readdir(baselineDirectory))
    .filter(name => name.endsWith('.windows.png'))
    .sort()
  if (!windowsFiles.length) throw new Error('No Windows render baselines exist to seed')
  for (const windowsName of windowsFiles) {
    const linuxName = windowsName.replace(/\.windows\.png$/, '.linux.png')
    await writeFile(
      join(baselineDirectory, linuxName),
      await readFile(join(baselineDirectory, windowsName)),
    )
  }
  await writeFile(join(baselineDirectory, 'linux.status'), 'seeded-from-windows\n')
  process.stdout.write(`Seeded ${windowsFiles.length} Linux baseline filenames byte-identically from Windows; no Linux renderer was executed.\n`)
  process.exit(0)
}

const platformIndex = argumentsList.indexOf('--platform')
const requestedPlatform = platformIndex >= 0 ? argumentsList[platformIndex + 1] : undefined
if (requestedPlatform !== 'windows' && requestedPlatform !== 'linux') {
  throw new Error('Usage: node scripts/generate-render-baselines.mjs --platform windows|linux')
}
const actualPlatform = process.platform === 'win32'
  ? 'windows'
  : process.platform === 'linux'
    ? 'linux'
    : undefined
if (actualPlatform !== requestedPlatform) {
  throw new Error(`Cannot generate ${requestedPlatform} baselines on ${process.platform}`)
}

const vitestCli = join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs')
const result = spawnSync(process.execPath, [
  vitestCli,
  'run',
  'tests/render/templates.spec.ts',
  '-t',
  'matches fixed platform baselines within 0.5% changed pixels',
], {
  cwd: projectRoot,
  env: {
    ...process.env,
    MAI_UPDATE_RENDER_BASELINES: '1',
    MAI_BASELINE_PLATFORM: requestedPlatform,
  },
  stdio: 'inherit',
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
process.stdout.write(`Generated ${requestedPlatform} render baselines using the local Takumi runtime.\n`)
