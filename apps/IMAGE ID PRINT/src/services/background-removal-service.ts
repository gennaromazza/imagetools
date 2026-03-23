const BASE_URL = (
  (import.meta as unknown as { env?: { VITE_REMBG_ENDPOINT?: string } }).env?.VITE_REMBG_ENDPOINT
  ?? 'http://localhost:7010/remove-background'
).replace(/\/remove-background$/, '')

const REMBG_ENDPOINT = `${BASE_URL}/remove-background`
const HEALTH_ENDPOINT = `${BASE_URL}/health`

export async function isRembgAvailable(timeoutMs = 3000): Promise<boolean> {
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
): Promise<Blob> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const formData = new FormData()
    formData.append('image', inputBlob, 'input.png')

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
