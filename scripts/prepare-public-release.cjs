// Package exactly the Git-tracked source files and the existing NSIS installer.
// Private user data and local build caches are never included in the source ZIP.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '..');
const output = path.resolve(root, '../../outputs');
const version = require('../package.json').version;

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const installer = `Qixu-Setup-${version}-x64.exe`;
  const archive = `Qixu-source-${version}.zip`;
  const srcInstaller = path.join(root, 'release', installer);
  await fs.access(srcInstaller);

  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }).split('\0').filter(Boolean);
  if (tracked.length < 30 || !tracked.includes('README.md')) {
    throw new Error('Source repository has not been staged; refusing incomplete archive');
  }
  const zip = new JSZip();
  for (const file of tracked) {
    const safe = file.replace(/\\/g, '/');
    if (safe.startsWith('../') || path.isAbsolute(safe)) throw new Error(`Unsafe source path ${file}`);
    zip.file(`Qixu-source/${safe}`, await fs.readFile(path.join(root, file)));
  }
  await fs.writeFile(path.join(output, archive), await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  }));
  await fs.copyFile(srcInstaller, path.join(output, installer));
  await fs.copyFile(path.join(root, `docs/release-notes-${version}.md`), path.join(output, `Qixu-Release-${version}.md`));

  await fs.copyFile(path.join(root, 'docs/使用说明.md'), path.join(output, '栖序-使用说明.md'));
  await fs.copyFile(path.join(root, 'docs/features-'+version+'.md'), path.join(output, 'Qixu-Features-'+version+'.md'));
  await fs.copyFile(path.join(root, 'docs/test-record-'+version+'.md'), path.join(output, 'Qixu-Tests-'+version+'.md'));
  const names = [installer, archive, '栖序-使用说明.md', 'Qixu-Features-'+version+'.md', 'Qixu-Tests-'+version+'.md', `Qixu-Release-${version}.md`];
  const lines = [];
  for (const name of names) {
    const p = path.join(output, name);
    lines.push(`${await sha256(p)}  ${name}`);
    const stat = await fs.stat(p);
    console.log(`${name} (${stat.size} bytes)`);
  }
  await fs.writeFile(path.join(output, `Qixu-SHA256SUMS-${version}.txt`), `${lines.join('\n')}\n`);
  console.log(`Published assets prepared in: ${output}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
