export const RELEASE_SCHEMA_VERSION: 1;
export const MANIFEST_FILE_NAME: 'release-manifest.json';
export const CURRENT_POINTER_FILE_NAME: 'current.json';
export const DEFAULT_RELEASE_ROOT: string;

export interface V7StaticReleaseVerification {
  releaseId: string;
  releaseDirectory: string;
  fileCount: number;
  manifestSha256: string;
}

export interface V7StaticReleaseAssembly extends V7StaticReleaseVerification {
  sourceFileCount: number;
}

export type StaticRequestResolution =
  | { kind: 'upstream' }
  | { kind: 'redirect'; location: '/v7/' }
  | { kind: 'file'; path: string };

export function resolveReleaseRoot(projectRoot: string, requestedRoot?: string): string;

export function resolveStaticRequest(
  requestTarget: string,
  availableFiles: ReadonlySet<string>
): StaticRequestResolution;

export function verifyV7StaticRelease(releaseDirectory: string): Promise<V7StaticReleaseVerification>;

export function assembleV7StaticRelease(options: {
  projectRoot: string;
  authorDist?: string;
  adminDist?: string;
  releaseRoot?: string;
}): Promise<V7StaticReleaseAssembly>;

export function resolveCurrentV7StaticRelease(
  projectRoot: string,
  releaseRoot?: string
): Promise<V7StaticReleaseVerification>;
