import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rename, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const workspaceRoot = resolve(projectRoot, '../..')
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true }),
  ))
})

describe('published package entry', () => {
  it('loads the packed CommonJS entry and renders with packaged fonts', async () => {
    const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
    expect(packageJson).toMatchObject({
      main: 'lib/index.js',
      typings: 'lib/index.d.ts',
      files: [
        'lib',
        'assets/fallback',
        'assets/fonts',
        'assets/generated',
      ],
      repository: {
        type: 'git',
        url: 'https://github.com/KeiMaidDev/koishi-plugin-mai-plugin.git',
      },
      bugs: {
        url: 'https://github.com/KeiMaidDev/koishi-plugin-mai-plugin/issues',
      },
    })
    expect(packageJson).not.toHaveProperty('type')
    expect(packageJson).not.toHaveProperty('exports')
    expect(packageJson.description).toEqual(expect.stringMatching(/\S/))
    expect(packageJson.homepage).toEqual(expect.stringMatching(/^https:\/\//))
    expect(packageJson.koishi?.description?.zh).toEqual(expect.stringMatching(/\S/))
    expect(packageJson.koishi?.service?.required).toEqual(['database', 'server'])
    for (const script of ['build', 'build:types', 'build:js', 'prepack']) {
      expect(packageJson.scripts).not.toHaveProperty(script)
    }
    expect(packageJson.devDependencies).not.toHaveProperty('vite')

    const temporary = await mkdtemp(join(tmpdir(), 'mai-plugin-pack-import-'))
    temporaryDirectories.push(temporary)
    const packedDirectory = join(temporary, 'packed')
    const extractedDirectory = join(temporary, 'extracted')
    const installedDirectory = join(temporary, 'node_modules', packageJson.name)
    await Promise.all([
      mkdir(packedDirectory, { recursive: true }),
      mkdir(extractedDirectory, { recursive: true }),
      mkdir(join(temporary, 'node_modules'), { recursive: true }),
    ])

    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    const npmCommand = process.platform === 'win32' ? process.execPath : 'npm'
    const npmArgs = process.platform === 'win32' ? [npmCli] : []
    const { stdout } = await execFileAsync(npmCommand, [
      ...npmArgs,
      'pack',
      '--json',
      '--pack-destination',
      packedDirectory,
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })
    const [packResult] = JSON.parse(stdout) as [{ filename: string, files: Array<{ path: string }> }]
    const packedPaths = packResult.files.map(file => file.path.replaceAll('\\', '/'))
    expect(packedPaths).toEqual(expect.arrayContaining([
      'lib/index.js',
      'lib/index.d.ts',
      'assets/fallback/avatar.png',
      'assets/fallback/cover.png',
      'assets/fallback/plate.png',
      'assets/fonts/NotoSansSC-Regular.otf',
      'assets/fonts/NotoSansSC-Bold.otf',
      'assets/fonts/OFL.txt',
      'assets/fonts/SOURCE.md',
      'assets/generated/utage-icon.png',
    ]))
    expect(packedPaths.filter(path => path.endsWith('.otf'))).toEqual([
      'assets/fonts/NotoSansSC-Bold.otf',
      'assets/fonts/NotoSansSC-Regular.otf',
    ])
    expect(packedPaths).not.toEqual(expect.arrayContaining([
      'package-lock.json',
      'task.md',
      'tsconfig.tsbuildinfo',
      'vite.config.ts',
    ]))
    expect(packedPaths.every(path => !/^(?:dist|docs|src|tests)\//.test(path))).toBe(true)
    expect(packedPaths.every(path => !/\.(?:log|map|sqlite|sqlite3)$/.test(path))).toBe(true)

    await execFileAsync('tar', [
      '-xf',
      join(packedDirectory, packResult.filename),
      '-C',
      extractedDirectory,
    ])
    await rename(join(extractedDirectory, 'package'), installedDirectory)

    const dependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {}),
    ]
    for (const name of dependencyNames) {
      const segments = name.split('/')
      const target = join(workspaceRoot, 'node_modules', ...segments)
      const link = join(temporary, 'node_modules', ...segments)
      await mkdir(dirname(link), { recursive: true })
      await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    }

    const script = `
      (async () => {
      const { readFileSync } = require('node:fs');
      const manifestPath = require.resolve(${JSON.stringify(`${packageJson.name}/package.json`)});
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.name !== ${JSON.stringify(packageJson.name)}) {
        throw new Error('resolved the wrong package manifest');
      }
      const plugin = require(${JSON.stringify(packageJson.name)});
      if (typeof plugin.apply !== 'function') throw new Error('missing apply export');
      if (!plugin.Config || plugin.name !== 'mai-plugin') throw new Error('missing plugin metadata exports');
      const renderer = new plugin.TakumiRenderService({ timeoutMs: 30000 });
      await renderer.initialize();
      const image = await renderer.render(plugin.createContainerNode({
        style: {
          width: '100%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: plugin.MAIMAI_RENDER_THEME.fontFamily,
        },
        children: [plugin.createTextNode({ text: 'Mai package import', style: { fontSize: 20 } })],
      }), { width: 160, height: 90, format: 'png' });
      if (image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
        throw new Error('packed renderer returned a non-PNG result');
      }
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    `
    await execFileAsync(process.execPath, ['--eval', script], {
      cwd: temporary,
      encoding: 'utf8',
      timeout: 30_000,
    })
  }, 60_000)
})
