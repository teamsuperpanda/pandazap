// The plugin runs in Obsidian's renderer and uses window timers. The Node test
// environment has no window, so provide one that follows the active timers.
Object.assign(globalThis, {
  window: {
    setTimeout: (callback: () => void, delay?: number) => setTimeout(callback, delay),
    clearTimeout: (id?: number) => clearTimeout(id),
  },
});
