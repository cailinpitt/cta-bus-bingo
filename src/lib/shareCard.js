// Client-side share-card generation. The build-time OG renderer uses resvg
// (Node), which we can't run in the browser, so milestone/achievement cards are
// drawn on a <canvas> and shared via the Web Share API (with a download
// fallback). Square 1080×1080 reads well in Messages / social.
//
// Visual style is inspired by cta-wrapped: bold flat palettes, chunky hero
// number with offset shadow, decorative blobs/stars/squiggle, yellow tag-pill
// eyebrow. Lighter than cta-wrapped: system font stack, no webfont download.

const W = 1080;
const H = 1080;
const CX = W / 2;
const FONT = '"Helvetica Neue", "Arial Black", Impact, system-ui, sans-serif';

// Default palette per card kind. Each card can override via the `palette` prop.
const PALETTES = {
  count: { bg: '#1d4ed8', primary: '#fde047', secondary: '#ec4899', ink: '#0b1020' },
  hood: { bg: '#ec4899', primary: '#fde047', secondary: '#0ea5e9', ink: '#1a0322' },
  all: { bg: '#fde047', primary: '#ec4899', secondary: '#1d4ed8', ink: '#1a1a1a' },
};

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
  shown.forEach((l, i) => {
    ctx.fillText(l, CX, y + i * lineHeight);
  });
  return y + (shown.length - 1) * lineHeight;
}

// A wobbly blob — adds depth in a corner without being a serious shape.
function drawBlob(ctx, cx, cy, baseR, color, seed = 1) {
  ctx.fillStyle = color;
  ctx.beginPath();
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const wobble = Math.sin(t * 3 + seed) * 0.08 + Math.cos(t * 5 + seed * 1.7) * 0.05;
    const r = baseR * (1 + wobble);
    const x = cx + Math.cos(t) * r;
    const y = cy + Math.sin(t) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawStar(ctx, cx, cy, outerR, color, rotation = 0) {
  const innerR = outerR * 0.45;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSquiggle(ctx, x, y, length, amplitude, waves, color, lineWidth = 8) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const steps = 80;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x + t * length;
    const py = y + Math.sin(t * Math.PI * 2 * waves) * amplitude;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

// Yellow rounded "tag" pill, e.g. the eyebrow header.
function drawTag(ctx, text, cx, cy, fontSize, weight, bgColor, fgColor, padding = 28) {
  ctx.font = `${weight} ${fontSize}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + padding * 2;
  const h = fontSize * 1.55;
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.fillStyle = fgColor;
  ctx.fillText(text, cx, cy + fontSize * 0.06);
  ctx.textBaseline = 'alphabetic';
}

// Pills of route ids — the "marked squares" of your bingo card. Appends a
// neutral "+N more" pill when more routes contributed than fit visually.
function drawChips(ctx, chips, extra, cy, ink) {
  if (!chips?.length && !extra) return;
  const maxW = W - 80;
  // Try font/padding sizes until the row fits within maxW.
  const sizes = [
    { font: 38, gap: 14, h: 64, padX: 26, minW: 76 },
    { font: 34, gap: 12, h: 58, padX: 22, minW: 70 },
    { font: 30, gap: 10, h: 52, padX: 18, minW: 64 },
    { font: 26, gap: 8, h: 46, padX: 14, minW: 56 },
  ];
  const items = [...chips];
  if (extra > 0) items.push({ label: `+${extra} more`, color: '#e5e7eb', muted: true });
  let chosen = sizes[sizes.length - 1];
  let widths = [];
  for (const s of sizes) {
    ctx.font = `900 ${s.font}px ${FONT}`;
    widths = items.map((c) => Math.max(s.minW, ctx.measureText(c.label).width + s.padX * 2));
    const totalW = widths.reduce((a, b) => a + b, 0) + s.gap * (items.length - 1);
    if (totalW <= maxW) {
      chosen = s;
      break;
    }
    chosen = s;
  }
  ctx.font = `900 ${chosen.font}px ${FONT}`;
  const totalW = widths.reduce((a, b) => a + b, 0) + chosen.gap * (items.length - 1);
  let x = (W - totalW) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  items.forEach((c, i) => {
    const w = widths[i];
    roundRect(ctx, x, cy, w, chosen.h, chosen.h / 2);
    ctx.fillStyle = c.color;
    ctx.fill();
    ctx.fillStyle = c.muted ? '#374151' : ink;
    ctx.fillText(c.label, x + w / 2, cy + chosen.h / 2 + 2);
    x += w + chosen.gap;
  });
  ctx.textBaseline = 'alphabetic';
}

// Big chunky number with an offset shadow stroke underneath — the cta-wrapped
// "comic" treatment.
function drawHero(ctx, text, cy, primary, shadow) {
  ctx.font = `900 240px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Offset shadow stroke
  ctx.lineWidth = 10;
  ctx.strokeStyle = shadow;
  ctx.fillStyle = shadow;
  ctx.fillText(text, CX + 12, cy + 12);
  // Solid front
  ctx.fillStyle = primary;
  ctx.fillText(text, CX, cy);
  // Outline on top
  ctx.lineWidth = 6;
  ctx.strokeStyle = shadow;
  ctx.strokeText(text, CX, cy);
  ctx.textBaseline = 'alphabetic';
}

// Render a share card to a PNG Blob.
//   ring  = { value, max, big, label }  — hero number; `max`/`value` ignored visually here
//   chips = [{ label, color }]          — route-id pills
//   extra = number                       — count appended as "+N more" pill
//   kind  = 'count' | 'hood' | 'all'    — picks default palette
export async function renderShareCard({
  eyebrow = 'CTA BUS BINGO',
  title,
  sub = '',
  ring = null,
  chips = [],
  extra = 0,
  footer = '',
  kind = 'count',
  palette,
}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const p = palette || PALETTES[kind] || PALETTES.count;

  // Background
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);

  // Decorative shapes — big blob top-right, secondary blob bottom-left,
  // a few stars and a squiggle. Drawn before content so text stays on top.
  drawBlob(ctx, W + 60, 180, 320, p.secondary, 1);
  drawBlob(ctx, -120, H - 80, 280, p.primary, 2.4);
  drawStar(ctx, 110, 230, 36, p.primary, 0.2);
  drawStar(ctx, W - 140, H - 280, 28, p.secondary, -0.3);
  drawStar(ctx, 80, H - 220, 22, p.secondary, 0.5);
  drawSquiggle(ctx, 280, 855, W - 560, 10, 2.5, p.primary, 6);

  // Eyebrow tag pill
  drawTag(ctx, eyebrow, CX, 130, 36, 900, p.primary, p.ink, 32);

  // Hero number
  const heroCy = ring ? 420 : 380;
  if (ring) {
    drawHero(ctx, String(ring.big), heroCy, p.primary, p.secondary);
    if (ring.label) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 40px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(ring.label.toUpperCase(), CX, heroCy + 180);
    }
  }

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 72px ${FONT}`;
  ctx.textAlign = 'center';
  const titleY = ring ? 700 : 470;
  const afterTitle = drawCentered(ctx, title, titleY, W - 160, 82, 2);

  // Sub
  if (sub) {
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.85;
    ctx.font = `700 36px ${FONT}`;
    drawCentered(ctx, sub, afterTitle + 64, W - 200, 48, 2);
    ctx.globalAlpha = 1;
  }

  // Chips row
  drawChips(ctx, chips, extra, 900, p.ink);

  // Footer
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.75;
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText(footer, CX, H - 60);
  ctx.globalAlpha = 1;

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
