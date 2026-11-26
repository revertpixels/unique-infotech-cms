// Image compression utilities (canvas-based, no external libraries).

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot load image')); };
    img.src = url;
  });
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

function renderJpegBlob(img, w, h, quality, grayscale) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  if (grayscale) ctx.filter = 'grayscale(100%)';
  ctx.drawImage(img, 0, 0, w, h);
  ctx.filter = 'none';
  return canvasToJpegBlob(canvas, quality);
}

// Compress any image to JPEG under 100 KB.
// kind 'photo': long side max 600px; 'signature': max 800px, white background; 'doc': max 1600px.
// Loop: quality 0.85 -> down by 0.07 to 0.45; if still too big, scale to 85% and retry;
// for 'doc' only, if still too big at 1000px, convert to grayscale and retry; stop at min long side 500px.
async function compressTo100KB(file, kind) {
  if (file.size > 10 * 1024 * 1024) throw new Error('File too large (max 10 MB).');
  if (/^image\/(heic|heif)$/i.test(file.type)) {
    throw new Error('iPhone HEIC photos are not supported. Please share the photo as JPG.');
  }
  const MAX_BYTES = 100 * 1024;
  const maxSide = kind === 'photo' ? 600 : kind === 'signature' ? 800 : 1600;
  const isDoc = kind === 'doc';

  const img = await loadImage(file);
  const baseScale = Math.min(1, maxSide / Math.max(img.width, img.height));
  let w = Math.round(img.width * baseScale);
  let h = Math.round(img.height * baseScale);

  let quality = 0.85;
  let grayscale = false;
  let blob = await renderJpegBlob(img, w, h, quality, grayscale);

  while (blob.size > MAX_BYTES && quality > 0.45) {
    quality -= 0.07;
    blob = await renderJpegBlob(img, w, h, quality, grayscale);
  }

  while (blob.size > MAX_BYTES && Math.max(w, h) > 500) {
    w = Math.round(w * 0.85);
    h = Math.round(h * 0.85);
    if (isDoc && Math.max(w, h) <= 1000 && !grayscale) {
      grayscale = true;
      quality = 0.85;
      blob = await renderJpegBlob(img, w, h, quality, grayscale);
      while (blob.size > MAX_BYTES && quality > 0.45) {
        quality -= 0.07;
        blob = await renderJpegBlob(img, w, h, quality, grayscale);
      }
      if (blob.size <= MAX_BYTES) break;
    }
    quality = 0.85;
    blob = await renderJpegBlob(img, w, h, quality, grayscale);
    while (blob.size > MAX_BYTES && quality > 0.45) {
      quality -= 0.07;
      blob = await renderJpegBlob(img, w, h, quality, grayscale);
    }
  }

  if (blob.size > MAX_BYTES) {
    throw new Error('Could not reduce this image under 100 KB, please upload a clearer/smaller scan.');
  }

  return { blob, quality, width: w, height: h };
}

export { compressTo100KB };

export function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function blobToDataURL(blob) {
  if (!(blob instanceof Blob)) {
    return Promise.reject(new Error('blobToDataURL: expected a Blob, got ' + (blob === null || blob === undefined ? String(blob) : typeof blob + ' with keys ' + Object.keys(blob).join(','))));
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function dataURLToBlob(dataURL) {
  const parts = dataURL.split(',');
  const mime = parts[0].match(/:(.*?);/)[1];
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
}

export function isImageFile(file) {
  return /^image\/(jpeg|jpg|png|webp|gif|bmp|avif)$/i.test(file.type);
}

export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function loadBitmapFromSource(source) {
  return new Promise((resolve, reject) => {
    if (source && typeof source === 'object' && source.naturalWidth) {
      resolve(source);
      return;
    }
    const url = URL.createObjectURL(source);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode selected image.'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas encoding failed.'));
    }, mime, quality);
  });
}

/**
 * Renders a square avatar crop from `source` (File/Blob/Image) using normalized pan `fx`/`fy` in [-1, 1]
 * and zoom >= 1, compressing to WebP or JPEG under `maxBytes`.
 */
export async function cropSquareAvatarToBlob(source, cropState = {}, { maxBytes = 300 * 1024, size = 512 } = {}) {
  const img = await loadBitmapFromSource(source);
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  if (!nw || !nh) throw new Error('Invalid image dimensions.');

  const zoom = Math.max(1, Math.min(4, Number(cropState.zoom) || 1));
  const fx = Math.max(-1, Math.min(1, Number(cropState.fx) || 0));
  const fy = Math.max(-1, Math.min(1, Number(cropState.fy) || 0));

  const mimeCandidates = ['image/webp', 'image/jpeg'];
  const sizes = [size, Math.min(384, size), Math.min(256, size)];
  const qualities = [0.9, 0.82, 0.72, 0.62, 0.5];

  for (const outSize of sizes) {
    const canvas = document.createElement('canvas');
    canvas.width = outSize;
    canvas.height = outSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, outSize, outSize);

    const baseScale = Math.max(outSize / nw, outSize / nh);
    const drawW = nw * baseScale * zoom;
    const drawH = nh * baseScale * zoom;
    const maxDx = Math.max(0, (drawW - outSize) / 2);
    const maxDy = Math.max(0, (drawH - outSize) / 2);
    const drawX = (outSize - drawW) / 2 + fx * maxDx;
    const drawY = (outSize - drawH) / 2 + fy * maxDy;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    for (const mime of mimeCandidates) {
      for (const q of qualities) {
        const blob = await canvasToBlob(canvas, mime, q);
        if (blob.type === mime && blob.size <= maxBytes) {
          return { blob, mime, width: outSize, height: outSize };
        }
      }
    }
  }

  throw new Error('Could not compress avatar image under 300 KB. Please choose a smaller image.');
}
