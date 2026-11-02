import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const version='0.10.21';
const source=path.resolve('node_modules/@mediapipe/tasks-vision');
const target=path.resolve(`public/vision-runtime/${version}`);
const model=await readFile('public/models/efficientdet-lite0-int8-v1.tflite');
if(createHash('sha256').update(model).digest('hex')!=='0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb')throw new Error('The local detection model failed its integrity check.');
const manifest=JSON.parse(await readFile(path.join(source,'package.json'),'utf8'));
if(manifest.version!==version)throw new Error('Update and verify the pinned vision runtime before building.');
await mkdir(path.join(target,'wasm'),{recursive:true});
// The package has ESM/CJS entries. Wrap its self-contained CJS entry for a
// classic worker, whose importScripts is required by this WASM loader.
const bundle=await readFile(path.join(source,'vision_bundle.cjs'),'utf8');
await writeFile(path.join(target,'vision.js'),`/* MediaPipe ${version}, Apache-2.0. Modified: classic-worker export wrapper. */\nvar exports={};\n${bundle}\nself.WorldOSVision=exports;\n`);
for(const file of ['vision_wasm_internal.js','vision_wasm_internal.wasm','vision_wasm_nosimd_internal.js','vision_wasm_nosimd_internal.wasm'])await copyFile(path.join(source,'wasm',file),path.join(target,'wasm',file));
console.log(`Prepared local vision runtime ${version}.`);
