/**
 * One-off script: trim logo, remove white background, export favicon + header sizes.
 * Run from Frontend/: node scripts/generate-brand-assets.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const publicDir = path.join(frontendRoot, 'public');

const sourceCandidates = [
  path.join(frontendRoot, '..', 'Assets', 'hub-logo-source.png'),
  path.resolve(
    frontendRoot,
    '..',
    '..',
    '..',
    '.cursor',
    'projects',
    'd-Cursor-Downstream-Hub-V1',
    'assets',
    'c__Users_04125050828_AppData_Roaming_Cursor_User_workspaceStorage_6d5338661fb65a4a2b127fe9cdb94502_images_Gemini_Generated_Image_mdx7aamdx7aamdx7-41257ac8-5e00-4f91-ba43-13c1b541a7b5.png'
  ),
];

const sourcePath = sourceCandidates.find((p) => fs.existsSync(p));
if (!sourcePath) {
  console.error('Logo source not found. Expected one of:', sourceCandidates);
  process.exit(1);
}

fs.mkdirSync(publicDir, { recursive: true });

function makeBackgroundTransparent(buffer) {
  for (let i = 0; i < buffer.length; i += 4) {
    const r = buffer[i];
    const g = buffer[i + 1];
    const b = buffer[i + 2];
    const isWhite = r >= 245 && g >= 245 && b >= 245;
    const isBlack = r <= 20 && g <= 20 && b <= 20;
    if (isWhite || isBlack) {
      buffer[i + 3] = 0;
    }
  }
  return buffer;
}

async function buildTransparentLogo() {
  const trimmed = await sharp(sourcePath).trim({ threshold: 12 }).ensureAlpha().png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const { data, info } = await sharp(trimmed)
    .raw()
    .toBuffer({ resolveWithObject: true });

  makeBackgroundTransparent(data, info.width, info.height);

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  }).png();
}

async function writeSized(image, size, filename, paddingRatio = 0.08) {
  const padded = Math.round(size * (1 - paddingRatio * 2));
  await image
    .clone()
    .resize(padded, padded, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: Math.round(size * paddingRatio),
      bottom: Math.round(size * paddingRatio),
      left: Math.round(size * paddingRatio),
      right: Math.round(size * paddingRatio),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(path.join(publicDir, filename));
}

async function main() {
  const logo = await buildTransparentLogo();

  await logo.clone().png().toFile(path.join(publicDir, 'logo.png'));
  await writeSized(logo, 512, 'logo-512.png', 0.06);
  await writeSized(logo, 192, 'logo-192.png', 0.08);
  await writeSized(logo, 180, 'apple-touch-icon.png', 0.08);
  await writeSized(logo, 32, 'favicon-32x32.png', 0.06);
  await writeSized(logo, 16, 'favicon-16x16.png', 0.04);

  // ICO is a renamed 32px PNG — sufficient for modern browsers as /favicon.ico
  await fs.promises.copyFile(
    path.join(publicDir, 'favicon-32x32.png'),
    path.join(publicDir, 'favicon.ico')
  );

  const manifest = {
    name: 'Downstream Hub',
    short_name: 'Downstream Hub',
    icons: [
      { src: '/logo-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/logo-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
  await fs.promises.writeFile(
    path.join(publicDir, 'site.webmanifest'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  console.log('Brand assets written to', publicDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
