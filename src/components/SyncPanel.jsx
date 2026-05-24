import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

// Cross-device sync controls. Before setup it's an opt-in (create a group or join
// one by code); after, it shows status and a QR/link/code to pair another device.
// The QR encodes a deep link (#sync=<key>) so a scanned device opens the app
// already configured. See plan.md / src/lib/sync.js.

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

const KEY_RE = /^[A-Za-z0-9_-]{22,43}$/;

export default function SyncPanel({
  enabled,
  status,
  deepLink,
  syncKey,
  onEnable,
  onJoin,
  onRotate,
  onDisconnect,
}) {
  const [showPair, setShowPair] = useState(false);
  const [qr, setQr] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinErr, setJoinErr] = useState('');
  const [flash, setFlash] = useState('');
  const [confirm, setConfirm] = useState(null); // 'disconnect' | 'rotate' | null

  // Auto-clear the transient confirmation banner.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 2500);
    return () => clearTimeout(t);
  }, [flash]);

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

  function submitJoin(e) {
    e.preventDefault();
    const code = joinCode.trim();
    if (!KEY_RE.test(code)) {
      setJoinErr("That doesn't look like a sync code.");
      return;
    }
    setJoinErr('');
    setFlash('Joined ✓');
    onJoin(code);
  }

  async function copy(text, setFlag) {
    try {
      await navigator.clipboard.writeText(text);
      setFlag(true);
      setTimeout(() => setFlag(false), 1500);
    } catch {
      // clipboard blocked — the visible value is still there to copy by hand
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
          then scan a QR code (or paste the sync code) on the others — no account needed.
        </p>
        <button
          type="button"
          onClick={() => {
            onEnable();
            setShowPair(true);
          }}
          className="w-full rounded bg-emerald-700 px-2 py-1.5 text-white text-xs hover:bg-emerald-600"
        >
          Set up sync
        </button>
        <div className="my-2 text-center text-[10px] text-gh-muted/60 uppercase tracking-wide">
          or
        </div>
        <form onSubmit={submitJoin} className="flex flex-col gap-1">
          <span className="text-[10px] text-gh-muted uppercase tracking-wide">
            Join with a sync code
          </span>
          <div className="flex gap-1">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="paste sync code"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded bg-gh-canvas px-2 py-1 text-white text-xs placeholder:text-gh-muted/50"
            />
            <button
              type="submit"
              className="rounded bg-blue-600 px-2 py-1 text-white text-xs hover:bg-blue-500"
            >
              Join
            </button>
          </div>
          {joinErr && <div className="text-[11px] text-amber-300">{joinErr}</div>}
        </form>
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

      {flash && (
        <div className="mb-2 rounded border border-emerald-700/60 bg-emerald-900/30 px-2 py-1 text-emerald-200 text-xs">
          {flash}
        </div>
      )}

      {confirm === 'disconnect' ? (
        <div className="flex items-center justify-between gap-2 rounded border border-gh-border px-2 py-1.5 text-xs">
          <span className="text-gh-muted">Disconnect this device? Your routes stay on it.</span>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => {
                setConfirm(null);
                onDisconnect();
              }}
              className="rounded bg-red-700 px-2 py-0.5 text-white hover:bg-red-600"
            >
              Disconnect
            </button>
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="rounded bg-gh-subtle px-2 py-0.5 text-gh-muted hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
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
            onClick={() => setConfirm('disconnect')}
            className="rounded bg-gh-subtle px-2 py-1 text-gh-muted text-xs hover:text-white"
          >
            Disconnect
          </button>
        </div>
      )}

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
            onClick={() => copy(deepLink, setLinkCopied)}
            className="w-full rounded bg-gh-subtle px-2 py-1 text-white text-xs hover:bg-gh-border"
          >
            {linkCopied ? 'Copied!' : 'Copy pairing link'}
          </button>
          <div className="w-full">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gh-muted text-[10px] uppercase tracking-wide">
                Sync code (back this up to recover)
              </span>
              <button
                type="button"
                onClick={() => copy(syncKey, setCodeCopied)}
                className="shrink-0 rounded bg-gh-subtle px-1.5 py-0.5 text-[10px] text-white hover:bg-gh-border"
              >
                {codeCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <code className="block break-all text-white/80 text-xs">{syncKey}</code>
          </div>

          {confirm === 'rotate' ? (
            <div className="w-full rounded border border-amber-700/50 bg-amber-900/20 px-2 py-1.5 text-amber-200 text-xs">
              <p className="mb-1">
                Make a new code? Your routes carry over, but other devices must re-pair with the new
                code.
              </p>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setConfirm(null);
                    onRotate();
                  }}
                  className="rounded bg-amber-700 px-2 py-0.5 text-white hover:bg-amber-600"
                >
                  Rotate
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm(null)}
                  className="rounded bg-gh-subtle px-2 py-0.5 text-gh-muted hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm('rotate')}
              className="text-gh-muted text-[11px] underline hover:text-white"
            >
              Rotate sync key
            </button>
          )}
        </div>
      )}
    </div>
  );
}
