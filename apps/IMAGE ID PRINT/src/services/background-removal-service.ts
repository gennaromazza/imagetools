import { getRembgEndpoint } from '../lib/desktop-runtime'

export interface BackgroundRemovalOptions {
  backgroundRefine?: number
}

export async function isRembgAvailable(timeoutMs = 3000): Promise<boolean> {
  const HEALTH_ENDPOINT = getRembgEndpoint('/health')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(HEALTH_ENDPOINT, { signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function removeBackgroundWithLocalService(
  inputBlob: Blob,
  timeoutMs = 20000,
  options: BackgroundRemovalOptions = {},
): Promise<Blob> {
  const REMBG_ENDPOINT = getRembgEndpoint('/remove-background')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const formData = new FormData()
    formData.append('image', inputBlob, 'input.png')
    const refine = Math.max(0, Math.min(1, options.backgroundRefine ?? 0.35))
    formData.append('backgroundRefine', String(refine))

    const res = await fetch(REMBG_ENDPOINT, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    })

    if (!res.ok) {
      throw new Error(`Background removal failed (${res.status})`)
    }

    return await res.blob()
  } finally {
    clearTimeout(timer)
  }
}
