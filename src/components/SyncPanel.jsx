import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

// Cross-device sync controls. Before setup it's a one-button opt-in; after, it
// shows status and a QR/link to pair another device. The QR encodes a deep link
// (#sync=<key>) so a scanned device opens the app already configured — one scan,
// then both devices converge automatically. See plan.md / src/lib/sync.js.

function relativeTime(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

function statusLabel(status) {
  switch (status?.state) {
    case 'syncing':
      return { text: 'Syncing…', cls: 'text-gh-muted' };
    case 'offline':
      return { text: 'Offline — will sync later', cls: 'text-amber-300' };
    case 'idle':
      return {
        text: `Synced ✓${status.lastSyncedAt ? ` · ${relativeTime(status.lastSyncedAt)}` : ''}`,
        cls: 'text-emerald-300',
      };
    default:
      return { text: 'Sync on', cls: 'text-gh-muted' };
  }
}

export default function SyncPanel({ enabled, status, deepLink, syncKey, onEnable, onDisconnect }) {
  const [showPair, setShowPair] = useState(false);
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState(false);

  // Render the QR lazily, only while the pairing section is open.
  useEffect(() => {
    if (!showPair || !deepLink) {
      setQr(null);
      return;
    }
    let alive = true;
    QRCode.toDataURL(deepLink, { margin: 1, width: 220 })
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => {
        if (alive) setQr(null);
      });
    return () => {
      alive = false;
    };
  }, [showPair, deepLink]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(deepLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — the visible code/link is still there to copy by hand
    }
  }

  if (!enabled) {
    return (
      <div className="rounded-lg border border-gh-border bg-gh-surface p-3 text-sm">
        <div className="mb-2 text-gh-muted text-xs uppercase tracking-wide">
          Sync across devices
        </div>
        <p className="mb-2 text-gh-muted text-xs">
          Keep your ridden routes in sync between your phone and computer. Set it up on one device,
          then scan a QR code on the others — no account, just one scan each.
        </p>
        <button
          type="button"
          onClick={onEnable}
          className="w-full rounded bg-emerald-700 px-2 py-1.5 text-white text-xs hover:bg-emerald-600"
        >
          Set up sync
        </button>
      </div>
    );
  }

  const label = statusLabel(status);
  return (
    <div className="rounded-lg border border-gh-border bg-gh-surface p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-gh-muted text-xs uppercase tracking-wide">Sync</span>
        <span className={`text-xs ${label.cls}`}>{label.text}</span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setShowPair((v) => !v)}
          className="flex-1 rounded bg-gh-subtle px-2 py-1 text-white text-xs hover:bg-gh-border"
        >
          {showPair ? 'Hide pairing' : 'Add a device'}
        </button>
        <button
          type="button"
          onClick={onDisconnect}
          className="rounded bg-gh-subtle px-2 py-1 text-gh-muted text-xs hover:text-white"
        >
          Disconnect
        </button>
      </div>

      {showPair && (
        <div className="mt-3 flex flex-col items-center gap-2 border-gh-border border-t pt-3">
          <p className="text-center text-gh-muted text-xs">
            Scan this on another device, or open the link there. Each device only needs to do this
            once.
          </p>
          {qr ? (
            <img
              src={qr}
              alt="Sync pairing QR code"
              className="h-44 w-44 rounded bg-white p-1"
              width={220}
              height={220}
            />
          ) : (
            <div className="flex h-44 w-44 items-center justify-center rounded bg-gh-canvas text-gh-muted text-xs">
              generating…
            </div>
          )}
          <button
            type="button"
            onClick={copyLink}
            className="w-full rounded bg-gh-subtle px-2 py-1 text-white text-xs hover:bg-gh-border"
          >
            {copied ? 'Copied!' : 'Copy pairing link'}
          </button>
          <div className="w-full">
            <div className="text-gh-muted text-[10px] uppercase tracking-wide">
              Sync code (back this up to recover)
            </div>
            <code className="block break-all text-white/80 text-xs">{syncKey}</code>
          </div>
        </div>
      )}
    </div>
  );
}
