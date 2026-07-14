(() => {
  function launcherVisibleForPath(pathname = "") {
    return /^\/in\/[^/]+\/?$/i.test(pathname) || /^\/search\/results\/people\/?$/i.test(pathname);
  }

  globalThis.VelaLinkedInLauncher = Object.freeze({ launcherVisibleForPath });
})();
