// Thresholds fixed by specs/002-foundation-rewrite/plan.md (research.md §10, §11).

export const CHECK_THRESHOLDS = {
  /** Below this share of compared in-map pixels a fidelity region is "not checkable". */
  notCheckableComparedShare: 0.25,
  /** SC-007: allowed relative difference of median per-frame CPU time between map sizes. */
  sc007CpuTolerance: 0.2,
  /** SC-007: absolute floor for the CPU time difference, in ms. */
  sc007CpuFloorMs: 0.5,
  /** SC-007: allowed relative difference of GPU bytes between map sizes. */
  gpuBytesTolerance: 0.01,
  /**
   * Idle cadence with animated content: frames allowed beyond one per animation change in the window.
   * A frame due just before the window opens can be presented inside it when requestAnimationFrame runs
   * late under CPU throttling (spec 004 research "Pixel mapping at fractional display scales", T075).
   */
  idleCadenceSlackFrames: 1,
} as const
