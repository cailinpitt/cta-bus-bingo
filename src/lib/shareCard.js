// Client-side share-card generation. The build-time OG renderer uses resvg
// (Node), which we can't run in the browser, so milestone/achievement cards are
// drawn on a <canvas> and shared via the Web Share API (with a download
// fallback). Square 1080×1080 reads well in Messages / social.

const W = 1080;
const H = 1080;
const CX = W / 2;
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function spaceOut(s) {
  return s.split('').join('  ');
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// Centered, wrapped text. Returns the y after the last line.
function drawCentered(ctx, text, y, maxWidth, lineHeight, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, maxLines);
  shown.forEach((l, i) => ctx.fillText(l, CX, y + i * lineHeight));
  return y + (shown.length - 1) * lineHeight;
}

function drawRing(ctx, cy, r, frac, accent) {
  const start = -Math.PI / 2;
  ctx.lineCap = 'round';
  ctx.lineWidth = 36;
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.arc(CX, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  const grad = ctx.createLinearGradient(CX - r, cy - r, CX + r, cy + r);
  grad.addColorStop(0, accent);
  grad.addColorStop(1, '#38bdf8');
  ctx.strokeStyle = grad;
  ctx.beginPath();
  ctx.arc(CX, cy, r, start, start + Math.PI * 2 * Math.max(0.02, Math.min(1, frac)));
  ctx.stroke();
}

// Pills of route ids in varied colors — the "marked squares" of your bingo card.
function drawChips(ctx, chips, cy) {
  if (!chips?.length) return;
  ctx.font = `700 36px ${FONT}`;
  const gap = 16;
  const h = 60;
  const padX = 26;
  const widths = chips.map((c) => Math.max(72, ctx.measureText(c.label).width + padX * 2));
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * (chips.length - 1);
  let x = (W - totalW) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  chips.forEach((c, i) => {
    const w = widths[i];
    roundRect(ctx, x, cy, w, h, 30);
    ctx.fillStyle = c.color;
    ctx.fill();
    ctx.fillStyle = '#0b1020';
    ctx.fillText(c.label, x + w / 2, cy + h / 2 + 2);
    x += w + gap;
  });
  ctx.textBaseline = 'alphabetic';
}

// Render a share card to a PNG Blob.
//   ring  = { value, max, big, label }  — donut + centered hero text
//   chips = [{ label, color }]          — route-id pills
export async function renderShareCard({
  eyebrow = 'CTA BUS BINGO',
  title,
  sub = '',
  ring = null,
  chips = [],
  footer = '',
  accent = '#34d399',
}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background + accent glow behind the ring for depth.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b1020');
  bg.addColorStop(1, '#141d30');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const ringCy = 430;
  const glow = ctx.createRadialGradient(CX, ringCy, 0, CX, ringCy, 560);
  glow.addColorStop(0, 'rgba(56,189,248,0.16)');
  glow.addColorStop(1, 'rgba(56,189,248,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 12);

  // Wordmark.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#9aa4b2';
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText(`\u{1F68C}  ${spaceOut(eyebrow)}`, CX, 150);

  // Hero ring with centered count.
  if (ring) {
    drawRing(ctx, ringCy, 180, ring.max > 0 ? ring.value / ring.max : 0, accent);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 150px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(String(ring.big), CX, ringCy - 6);
    ctx.textBaseline = 'alphabetic';
    if (ring.label) {
      ctx.fillStyle = '#9aa4b2';
      ctx.font = `600 38px ${FONT}`;
      ctx.fillText(spaceOut(ring.label.toUpperCase()), CX, ringCy + 110);
    }
  }

  // Title + caption.
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 76px ${FONT}`;
  const afterTitle = drawCentered(ctx, title, ring ? 720 : 470, W - 160, 86, 2);
  if (sub) {
    ctx.fillStyle = '#9aa4b2';
    ctx.font = `500 40px ${FONT}`;
    drawCentered(ctx, sub, afterTitle + 70, W - 180, 52, 2);
  }

  drawChips(ctx, chips, 880);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#6e7681';
  ctx.font = `500 32px ${FONT}`;
  ctx.fillText(footer, CX, H - 70);

  return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// Save a PNG Blob to the user's device.
export function downloadImage(blob, filename = 'cta-bus-bingo.png') {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Share a PNG Blob via the native share sheet (with image), falling back to a
// download when file-sharing isn't supported. Returns 'shared' | 'downloaded'
// | 'cancelled'.
export async function shareImage(blob, { filename = 'cta-bus-bingo.png', title, text } = {}) {
  if (!blob) return 'cancelled';
  const file = new File([blob], filename, { type: 'image/png' });
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      // otherwise fall through to download
    }
  }
  downloadImage(blob, filename);
  return 'downloaded';
}
