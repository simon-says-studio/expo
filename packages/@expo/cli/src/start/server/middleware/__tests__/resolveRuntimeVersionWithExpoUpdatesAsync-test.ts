import { vol } from 'memfs';

import { expoUpdatesCommandAsync } from '../../../../utils/expoUpdatesCli';
import {
  clearRuntimeVersionCache,
  resolveRuntimeVersionWithExpoUpdatesAsync,
} from '../resolveRuntimeVersionWithExpoUpdatesAsync';

jest.mock('../../../../utils/expoUpdatesCli', () => {
  const actual = jest.requireActual('../../../../utils/expoUpdatesCli');
  return { ...actual, expoUpdatesCommandAsync: jest.fn() };
});

const projectRoot = '/app';

function resolvesTo(...runtimeVersions: string[]) {
  const mock = jest.mocked(expoUpdatesCommandAsync);
  for (const runtimeVersion of runtimeVersions) {
    mock.mockResolvedValueOnce(JSON.stringify({ runtimeVersion }));
  }
  return mock;
}

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ 'package.json': '{}', 'app.json': '{}' }, projectRoot);
  clearRuntimeVersionCache();
  jest.mocked(expoUpdatesCommandAsync).mockReset();
});

describe(resolveRuntimeVersionWithExpoUpdatesAsync, () => {
  it('resolves once per platform while the project inputs are unchanged', async () => {
    const command = resolvesTo('fp-ios', 'fp-android');
    await expect(
      resolveRuntimeVersionWithExpoUpdatesAsync({ projectRoot, platform: 'ios' })
    ).resolves.toBe('fp-ios');
    await expect(
      resolveRuntimeVersionWithExpoUpdatesAsync({ projectRoot, platform: 'ios' })
    ).resolves.toBe('fp-ios');
    await expect(
      resolveRuntimeVersionWithExpoUpdatesAsync({ projectRoot, platform: 'android' })
    ).resolves.toBe('fp-android');
    expect(command).toHaveBeenCalledTimes(2);
  });

  it('shares one resolution between concurrent requests', async () => {
    const command = resolvesTo('fp-ios');
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        resolveRuntimeVersionWithExpoUpdatesAsync({ projectRoot, platform: 'ios' })
      )
    );
    expect(results).toEqual(['fp-ios', 'fp-ios', 'fp-ios']);
    expect(command).toHaveBeenCalledTimes(1);
  });

  it('resolves again when an input changes', async () => {
    const command = resolvesTo('fp-1', 'fp-2', 'fp-3');
    await resolveRuntimeVersionWithExpoUpdatesAsync({ projectRoot, platform: 'ios' });

    vol.writeFileSync(
      `${projectRoot}/package.json`,
      '{"dependencies":{"react-native-new":"1.0.0"}}'
    );
    await expect(
      resolveRuntimeVersionWithExpoUpdatesAsync({ projectRoot, platform: 'ios' })
    ).resolves.toBe('fp-2');

    vol.mkdirSync(`${projectRoot}/patches`);
    await expect(
      resolveRuntimeVersionWithExpoUpdatesAsync({ projectRoot, platform: 'ios' })
    ).resolves.toBe('fp-3');
    expect(command).toHaveBeenCalledTimes(3);
  });

  it('does not remember a failed resolution', async () => {
    const command = jest.mocked(expoUpdatesCommandAsync);
    command.mockRejectedValueOnce(new Error('boom'));
    command.mockResolvedValueOnce(JSON.stringify({ runtimeVersion: 'fp-ios' }));
    await expect(
      resolveRuntimeVersionWithExpoUpdatesAsync({ projectRoot, platform: 'ios' })
    ).rejects.toThrow('boom');
    await expect(
      resolveRuntimeVersionWithExpoUpdatesAsync({ projectRoot, platform: 'ios' })
    ).resolves.toBe('fp-ios');
    expect(command).toHaveBeenCalledTimes(2);
  });
});
