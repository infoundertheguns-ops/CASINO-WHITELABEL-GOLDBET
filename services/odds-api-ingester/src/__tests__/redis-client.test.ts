import { describe, it, expect, vi, beforeEach } from 'vitest';

const createClientMock = vi.fn();

vi.mock('redis', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

describe('redis-client', () => {
  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
  });

  it('lazily creates a client on first getRedisClient() call and reuses it', async () => {
    const fakeClient = {
      isOpen: true,
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    createClientMock.mockReturnValue(fakeClient);

    const mod = await import('../redis-client.js');
    const c1 = await mod.getRedisClient();
    const c2 = await mod.getRedisClient();

    expect(c1).toBe(c2);
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(fakeClient.connect).toHaveBeenCalledTimes(1);
  });

  it('uses REDIS_URL env when provided', async () => {
    const fakeClient = { isOpen: true, connect: vi.fn(), on: vi.fn(), quit: vi.fn() };
    createClientMock.mockReturnValue(fakeClient);
    const orig = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://example.test:9999';

    const mod = await import('../redis-client.js');
    await mod.getRedisClient();

    expect(createClientMock).toHaveBeenCalledWith({ url: 'redis://example.test:9999' });

    process.env.REDIS_URL = orig;
  });

  it('falls back to redis://127.0.0.1:6379 when REDIS_URL unset', async () => {
    const fakeClient = { isOpen: true, connect: vi.fn(), on: vi.fn(), quit: vi.fn() };
    createClientMock.mockReturnValue(fakeClient);
    const orig = process.env.REDIS_URL;
    delete process.env.REDIS_URL;

    const mod = await import('../redis-client.js');
    await mod.getRedisClient();

    expect(createClientMock).toHaveBeenCalledWith({ url: 'redis://127.0.0.1:6379' });

    if (orig !== undefined) process.env.REDIS_URL = orig;
  });

  it('reconnects when isOpen becomes false', async () => {
    const closedClient = { isOpen: false, connect: vi.fn(), on: vi.fn(), quit: vi.fn() };
    const freshClient = { isOpen: true, connect: vi.fn().mockResolvedValue(undefined), on: vi.fn(), quit: vi.fn() };
    createClientMock.mockReturnValueOnce(closedClient).mockReturnValueOnce(freshClient);

    const mod = await import('../redis-client.js');
    const first = await mod.getRedisClient();
    expect(first).toBe(closedClient);
    // simulate disconnect: closedClient.isOpen is already false
    const second = await mod.getRedisClient();
    expect(second).toBe(freshClient);
    expect(createClientMock).toHaveBeenCalledTimes(2);
  });
});
