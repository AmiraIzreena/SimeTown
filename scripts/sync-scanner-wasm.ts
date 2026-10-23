import fs from 'node:fs';
import path from 'node:path';

/**
 * Copies the barcode reader's WebAssembly file into public/, where the camera scanner loads it from on browsers
 * without a barcode reader of their own (components/features/camera-scan.tsx). Run it after updating
 * barcode-detector: npm run scanner:sync. tests/camera-scan.test.ts fails if the copy and the package disagree.
 */
const root = process.cwd();
const version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/zxing-wasm/package.json'), 'utf8')).version as string;
const from = path.join(root, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm');
const dir = path.join(root, 'public/vendor', `zxing-wasm-${version}`);
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(from, path.join(dir, 'zxing_reader.wasm'));
for (const old of fs.readdirSync(path.join(root, 'public/vendor'))) {
  if (old.startsWith('zxing-wasm-') && old !== `zxing-wasm-${version}`) fs.rmSync(path.join(root, 'public/vendor', old), { recursive: true });
}
console.log(`Scanner reader zxing-wasm ${version} copied to public/vendor/zxing-wasm-${version}/.`);
