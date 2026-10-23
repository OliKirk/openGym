// Reading food barcodes (EAN-13, EAN-8, UPC) from the camera, for the food log.
//
// The gym check-in reader (lib/scan-web.js) only needs QR, which jsQR covers everywhere. Food
// packs carry 1-D barcodes, and iOS Safari has no BarcodeDetector of its own, so this uses the
// browser's detector when it can read EAN and otherwise the `barcode-detector` ponyfill (MIT),
// whose decoder is zxing-cpp compiled to WebAssembly. The .wasm file is bundled with the app —
// not fetched from a CDN — so scanning works from the home-screen app offline too, and it is
// loaded only the first time someone opens the scanner.

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

let _detector = null

async function nativeDetector() {
  if (typeof globalThis.BarcodeDetector !== 'function') return null
  try {
    const supported = await globalThis.BarcodeDetector.getSupportedFormats?.()
    if (!supported || !FORMATS.some(f => supported.includes(f))) return null
    return new globalThis.BarcodeDetector({ formats: FORMATS.filter(f => supported.includes(f)) })
  } catch { return null }
}

async function ponyfillDetector() {
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  prepareZXingModule({
    overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  })
  return new BarcodeDetector({ formats: FORMATS })
}

/** The detector this browser will use, created once. */
export async function foodDetector() {
  if (!_detector) _detector = (await nativeDetector()) || (await ponyfillDetector())
  return _detector
}

/** A plausible product barcode: 8, 12 or 13 digits. */
export const isFoodCode = v => /^\d{8}$|^\d{12,13}$/.test(String(v || ''))

/** Reads a barcode from a <video>, <img>, canvas or ImageBitmap; resolves the digits or null. */
export async function readFoodCode(source) {
  const det = await foodDetector()
  const found = await det.detect(source)
  const hit = (found || []).map(b => String(b.rawValue || '').trim()).find(isFoodCode)
  return hit || null
}
