const DNP_MEDIA = [
  { widthMm: 100, heightMm: 150, label: '10x15 cm (4x6")' },
  { widthMm: 150, heightMm: 200, label: '15x20 cm (6x8")' },
  { widthMm: 150, heightMm: 230, label: '15x23 cm (6x9")' },
]

const IFRAME_CLEANUP_DELAY_MS = 2000

export function checkDnpCompatibility(widthMm: number, heightMm: number) {
  return DNP_MEDIA.find((media) => {
    const sameOrientation = Math.abs(media.widthMm - widthMm) <= 2 && Math.abs(media.heightMm - heightMm) <= 2
    const rotatedOrientation = Math.abs(media.widthMm - heightMm) <= 2 && Math.abs(media.heightMm - widthMm) <= 2
    return sameOrientation || rotatedOrientation
  })
}

export async function printForDnpRx1(
  canvas: HTMLCanvasElement,
  sheetWidthMm: number,
  sheetHeightMm: number,
): Promise<void> {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.97)
  const pageWidthMm = sheetWidthMm
  const pageHeightMm = sheetHeightMm

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0'
  document.body.appendChild(iframe)

  const frameWindow = iframe.contentWindow
  const frameDocument = iframe.contentDocument
  if (!frameWindow || !frameDocument) {
    document.body.removeChild(iframe)
    throw new Error('Print iframe unavailable')
  }

  frameDocument.open()
  frameDocument.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>DNP RX1 Print</title>
<style>
  @page {
    size: ${pageWidthMm}mm ${pageHeightMm}mm;
    margin: 0;
  }
  html, body {
    margin: 0;
    padding: 0;
    width: ${pageWidthMm}mm;
    height: ${pageHeightMm}mm;
    overflow: hidden;
    background: #fff;
  }
  img {
    display: block;
    width: ${pageWidthMm}mm;
    height: ${pageHeightMm}mm;
    object-fit: fill;
  }
</style>
</head>
<body></body>
</html>`)
  frameDocument.close()

  const body = frameDocument.body
  if (!body) {
    cleanupIframe(iframe)
    throw new Error('Print document body unavailable')
  }

  const img = frameDocument.createElement('img')
  img.alt = 'DNP RX1 print sheet'
  body.appendChild(img)

  try {
    await new Promise<void>((resolve, reject) => {
    const triggerPrint = () => {
      try {
        frameWindow.focus()
        frameWindow.print()
        resolve()
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Print failed'))
      }
    }

    img.onload = () => triggerPrint()
    img.onerror = () => reject(new Error('Unable to load print image'))
    img.src = dataUrl

    if (img.complete && img.naturalWidth > 0) {
      triggerPrint()
    }
    })

    window.setTimeout(() => {
      cleanupIframe(iframe)
    }, IFRAME_CLEANUP_DELAY_MS)
  } catch (error) {
    cleanupIframe(iframe)
    throw error
  }
}

function cleanupIframe(iframe: HTMLIFrameElement) {
  if (iframe.parentNode) {
    iframe.parentNode.removeChild(iframe)
  }
}
