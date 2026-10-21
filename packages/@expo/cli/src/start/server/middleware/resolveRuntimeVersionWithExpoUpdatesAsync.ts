import fs from 'fs';
import path from 'path';

import { env } from '../../../utils/env';
import {
  ExpoUpdatesCLIModuleNotFoundError,
  expoUpdatesCommandAsync,
} from '../../../utils/expoUpdatesCli';
import { manifestDebugEvent } from './events';
import type { RuntimePlatform } from './resolvePlatform';

// `runtimeversion:resolve` is a child process, and under the `fingerprint` runtime version
// policy it hashes the whole native project. Run per manifest request, that cost multiple
// seconds per request, and a development build loading a project asks for the manifest more
// than once before it shows anything. So the result is reused for as long as nothing it can
// depend on has changed. The key below is a cheap stat of the project inputs a runtime version
// is derived from; when any of them changes, the next request resolves again.
const RUNTIME_VERSION_INPUTS = [
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'app.json',
  'app.config.js',
  'app.config.ts',
  'app.config.json',
  'eas.json',
  'patches',
];

const runtimeVersionCache = new Map<string, Promise<string | null>>();

/** Modification times and sizes of everything a runtime version can be derived from. */
function runtimeVersionInputsKey(projectRoot: string, platform: RuntimePlatform): string {
  const inputs = [...RUNTIME_VERSION_INPUTS, platform];
  return inputs
    .map((input) => {
      try {
        const stat = fs.statSync(path.join(projectRoot, input));
        return `${input}:${stat.mtimeMs}:${stat.size}`;
      } catch {
        return `${input}:-`;
      }
    })
    .join('|');
}

/** @internal Exposed for testing. */
export function clearRuntimeVersionCache() {
  runtimeVersionCache.clear();
}

export async function resolveRuntimeVersionWithExpoUpdatesAsync({
  projectRoot,
  platform,
}: {
  projectRoot: string;
  platform: RuntimePlatform;
}): Promise<string | null> {
  const key = `${projectRoot}\0${platform}\0${runtimeVersionInputsKey(projectRoot, platform)}`;
  const cached = runtimeVersionCache.get(key);
  if (cached) {
    return cached;
  }
  // Only one entry per project and platform is kept: a changed input replaces the old one.
  for (const existing of runtimeVersionCache.keys()) {
    if (existing.startsWith(`${projectRoot}\0${platform}\0`)) {
      runtimeVersionCache.delete(existing);
    }
  }
  const pending = resolveUncachedAsync({ projectRoot, platform });
  runtimeVersionCache.set(key, pending);
  // A failed resolution is not remembered, so the next request tries again.
  pending.catch(() => runtimeVersionCache.delete(key));
  return pending;
}

async function resolveUncachedAsync({
  projectRoot,
  platform,
}: {
  projectRoot: string;
  platform: RuntimePlatform;
}): Promise<string | null> {
  try {
    const extraArgs = env.EXPO_DEBUG ? ['--debug'] : [];
    const resolvedRuntimeVersionJSONResult = await expoUpdatesCommandAsync(projectRoot, [
      'runtimeversion:resolve',
      '--platform',
      platform,
      ...extraArgs,
    ]);
    const runtimeVersionResult: { runtimeVersion: string | null } = JSON.parse(
      resolvedRuntimeVersionJSONResult
    );
    manifestDebugEvent('runtime_version_resolved', { result: resolvedRuntimeVersionJSONResult });

    return runtimeVersionResult.runtimeVersion ?? null;
  } catch (e: any) {
    if (e instanceof ExpoUpdatesCLIModuleNotFoundError) {
      return null;
    }
    throw e;
  }
}
