import { useRegisterSW } from 'virtual:pwa-register/react';

// Service-worker update prompt. With registerType:'prompt', a new deploy makes
// the SW wait; we surface a Reload button instead of updating silently (which on
// iOS PWAs meant force-quitting twice to pick up a deploy). We also poll for
// updates on focus + hourly so a foregrounded app notices new versions promptly.
export default function UpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const check = () => registration.update();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, 60 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-3">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-blue-600 px-4 py-2 text-white text-xs shadow-lg">
        <span>A new version is available.</span>
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="rounded-full bg-blue-800/70 px-3 py-1 hover:bg-blue-900"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="rounded-full px-2 py-1 text-blue-100 hover:text-white"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
