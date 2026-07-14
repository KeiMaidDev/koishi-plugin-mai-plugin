import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const outputArgumentIndex = process.argv.indexOf('--output')
if (outputArgumentIndex >= 0 && !process.argv[outputArgumentIndex + 1]) {
  throw new Error('--output requires a directory path')
}
const outputDirectory = outputArgumentIndex >= 0
  ? resolve(process.argv[outputArgumentIndex + 1])
  : join(projectRoot, 'assets', 'generated')

const svg = (width, height, body) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
)

const assets = [
  {
    name: 'rating-number-plate.png',
    width: 300,
    height: 104,
    body: '<rect x="2" y="2" width="296" height="100" rx="6" fill="#ffffff" stroke="#26313e" stroke-width="4"/><rect x="2" y="2" width="12" height="100" rx="4" fill="#f4b942"/><path d="M252 2h46v46z" fill="#00a8a8"/><path d="M298 56v46h-46z" fill="#ff5a66"/>',
  },
  {
    name: 'dan-badge.png',
    width: 150,
    height: 104,
    body: '<rect x="2" y="2" width="146" height="100" rx="6" fill="#202a36" stroke="#f4b942" stroke-width="4"/><path d="M75 12l22 22-22 22-22-22z" fill="#00a8a8" opacity="0.75"/><path d="M75 48l20 20-20 20-20-20z" fill="#ff5a66" opacity="0.8"/>',
  },
  {
    name: 'course-background-1.png',
    width: 1280,
    height: 760,
    body: '<rect width="1280" height="760" fill="#eef3f4"/><path d="M0 0h480L0 300z" fill="#00a8a8"/><path d="M1280 760H720l560-330z" fill="#ff5a66"/><path d="M0 690l380-210 270 280H0z" fill="#f4b942" opacity="0.72"/><g fill="#26313e" opacity="0.08"><rect x="510" y="80" width="660" height="24"/><rect x="580" y="126" width="590" height="12"/><rect x="730" y="160" width="440" height="12"/></g>',
  },
  {
    name: 'course-background-2.png',
    width: 1280,
    height: 760,
    body: '<rect width="1280" height="760" fill="#f4f5ef"/><path d="M0 0h520L0 350z" fill="#45c124" opacity="0.88"/><path d="M1280 0v330L910 0z" fill="#f8b709"/><path d="M1280 760H620l660-280z" fill="#7c4d91" opacity="0.82"/><g fill="#26313e" opacity="0.08"><circle cx="640" cy="130" r="95"/><circle cx="640" cy="130" r="55"/><circle cx="640" cy="130" r="20"/></g>',
  },
  {
    name: 'course-background-3.png',
    width: 1280,
    height: 760,
    body: '<rect width="1280" height="760" fill="#f2f1f5"/><path d="M0 0h390L0 390z" fill="#9f51dc"/><path d="M1280 0v420L860 0z" fill="#00a8a8"/><path d="M0 760h680L0 520z" fill="#ff6ffd" opacity="0.78"/><path d="M1280 760H760l520-250z" fill="#f4b942" opacity="0.88"/><g stroke="#26313e" stroke-width="10" opacity="0.07"><path d="M430 80l250 250 250-250" fill="none"/><path d="M430 150l250 250 250-250" fill="none"/></g>',
  },
  {
    name: 'course-final-plate.png',
    width: 220,
    height: 64,
    body: '<rect x="2" y="2" width="216" height="60" rx="6" fill="#b6293e" stroke="#ffffff" stroke-width="4"/><path d="M14 14h34L34 32l14 18H14l14-18z" fill="#f4b942"/><path d="M206 14h-34l14 18-14 18h34l-14-18z" fill="#f4b942"/>',
  },
  {
    name: 'status-plate.png',
    width: 120,
    height: 36,
    body: '<rect x="1" y="1" width="118" height="34" rx="4" fill="#26313e" stroke="#ffffff" stroke-width="2"/><rect x="7" y="7" width="6" height="22" rx="2" fill="#00a8a8"/><rect x="107" y="7" width="6" height="22" rx="2" fill="#ff5a66"/>',
  },
  {
    name: 'utage-icon.png',
    width: 48,
    height: 48,
    body: '<path d="M24 2l19 11v22L24 46 5 35V13z" fill="#ff6ffd" stroke="#26313e" stroke-width="4"/><path d="M15 17h18v5H15zm0 9h18v5H15z" fill="#ffffff"/>',
  },
]

await mkdir(outputDirectory, { recursive: true })
for (const asset of assets) {
  await sharp(svg(asset.width, asset.height, asset.body), { density: 72 })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(join(outputDirectory, asset.name))
}

process.stdout.write(`Generated ${assets.length} deterministic render assets in ${outputDirectory}\n`)
