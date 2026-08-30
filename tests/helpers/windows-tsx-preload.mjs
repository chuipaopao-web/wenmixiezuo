// tsx uses process.geteuid() only to name its cache directory. Managed Windows
// runtimes can make os.userInfo() fail before the tested Worker is imported.
if (process.platform === 'win32' && typeof process.geteuid !== 'function') {
  Object.defineProperty(process, 'geteuid', {
    configurable: true,
    value: () => process.pid
  });
}
