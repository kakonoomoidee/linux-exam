const { buildDriver, MockDriver } = require('../../src/services/containerDrivers');

// no DB, no useTestDb — pure behaviour of the mock driver

describe('MockDriver', () => {
  let driver;
  let logSpy;

  beforeEach(() => {
    driver = new MockDriver();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());

  test('create() returns a distinct id on every call', async () => {
    const a = await driver.create({ participantId: 7 });
    const b = await driver.create({ participantId: 7 });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^mock-container-7-/);
    expect(b).toMatch(/^mock-container-7-/);
  });

  test('destroy() on an unknown container does not throw (idempotent)', async () => {
    await expect(driver.destroy('never-existed')).resolves.toBeUndefined();
  });

  test('exec() resolves with exit code 0 and mock output', async () => {
    await expect(driver.exec('c', 'echo hi')).resolves.toEqual({
      exitCode: 0,
      output: '(mock output)',
    });
  });

  test('attachInteractive() rejects with a clear, actionable message (does not hang)', async () => {
    await expect(driver.attachInteractive('c')).rejects.toThrow(/MockDriver does not support interactive/i);
  });
});

describe('buildDriver', () => {
  test('returns a MockDriver when CONTAINER_DRIVER=mock (set by the test env)', () => {
    expect(process.env.CONTAINER_DRIVER).toBe('mock');
    expect(buildDriver()).toBeInstanceOf(MockDriver);
  });
});
