// Decode worker for classic (file://) builds (spec 004 research R3): the worker bundle is embedded
// as a string and started from a Blob URL, which is same-origin by construction; module scripts and
// URL workers are blocked for file:// pages.

/** Worker source injected by the host build (vite `define`). */
declare const __H3_WORKER_SOURCE__: string

export function classicWorkerFactory(source: string = __H3_WORKER_SOURCE__): () => Worker {
  return () => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    try {
      return new Worker(url)
    } finally {
      // The worker has fetched its script once construction returns.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }
  }
}
