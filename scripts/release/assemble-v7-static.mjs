import { assembleV7StaticRelease } from './v7-static-release.mjs';

const projectRoot = process.cwd();
const result = await assembleV7StaticRelease({ projectRoot });
console.log(JSON.stringify({ status: 'assembled', ...result }, null, 2));
