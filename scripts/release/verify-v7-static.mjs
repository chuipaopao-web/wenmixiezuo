import { resolveCurrentV7StaticRelease, verifyV7StaticRelease } from './v7-static-release.mjs';

const projectRoot = process.cwd();
const releaseDirectoryArgument = process.argv[2];
const result = releaseDirectoryArgument
  ? await verifyV7StaticRelease(releaseDirectoryArgument)
  : await resolveCurrentV7StaticRelease(projectRoot);
console.log(JSON.stringify({ status: 'verified', ...result }, null, 2));
