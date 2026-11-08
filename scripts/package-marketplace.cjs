const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function main() {
  const args = process.argv.slice(2);
  const publisher = args.length === 2 && args[0] === '--publisher' ? args[1] : '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(publisher) || publisher === 'local-dev') {
    throw new Error('需要真实 Publisher ID。用法：npm run package:marketplace -- --publisher 你的PublisherID');
  }
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  manifest.name = 'markdown-publish-bridge';
  manifest.publisher = publisher;
  delete manifest.scripts;
  delete manifest.devDependencies;
  if (Object.keys(manifest.dependencies).join(',') !== 'playwright-core') {
    throw new Error('运行依赖已变化，请更新发布打包脚本以包含全部运行依赖');
  }
  const outputDirectory = path.join(root, 'release');
  await fs.mkdir(outputDirectory, { recursive: true });
  const output = path.join(outputDirectory, `${manifest.name}-${manifest.version}.vsix`);
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-publish-bridge-'));
  try {
    await fs.writeFile(path.join(staging, 'package.json'), JSON.stringify(manifest, null, 2));
    await fs.writeFile(path.join(staging, '.vscodeignore'), '**/*.vsix\n');
    for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md', 'PRIVACY.md', 'PUBLISHING.md']) {
      await fs.copyFile(path.join(root, file), path.join(staging, file));
    }
    await fs.cp(path.join(root, 'dist'), path.join(staging, 'dist'), { recursive: true });
    await fs.mkdir(path.join(staging, 'assets'));
    await fs.copyFile(path.join(root, 'assets', 'icon.png'), path.join(staging, 'assets', 'icon.png'));
    await fs.mkdir(path.join(staging, 'node_modules'));
    await fs.cp(path.join(root, 'node_modules', 'playwright-core'), path.join(staging, 'node_modules', 'playwright-core'), { recursive: true });
    const cli = path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce');
    const result = spawnSync(process.execPath, [cli, 'package', '--allow-missing-repository', '--out', output], { cwd: staging, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`VSIX 打包失败，退出码 ${result.status}`);
    console.log(`商店安装包已生成：${output}\n发布者：${publisher}\n扩展标识：${publisher}.${manifest.name}`);
  } finally {
    const target = path.resolve(staging);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('markdown-publish-bridge-')) {
      throw new Error('临时目录校验失败，已停止清理');
    }
    await fs.rm(target, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
