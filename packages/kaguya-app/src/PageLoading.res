// SPDX-License-Identifier: MPL-2.0

// Global page-loading counter that drives the top progress bar.
// Call start() when a page fetch begins and done_() when it ends (all paths).
// done_() is safe to call multiple times (clamps at 0).

let _count: PreactSignals.signal<int> = PreactSignals.make(0)

let isLoading: PreactSignals.computed<bool> = PreactSignals.computed(() =>
  PreactSignals.value(_count) > 0
)

let start = () => PreactSignals.update(_count, n => n + 1)

let done_ = () => PreactSignals.update(_count, n => max(0, n - 1))
