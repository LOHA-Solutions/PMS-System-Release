export function workspaceAge(stamp, now) {
  const time = typeof stamp === 'string' ? Date.parse(stamp) : NaN
  if (!Number.isFinite(time) || !Number.isFinite(now)) return { state: 'unknown' }
  if (time > now) return { state: 'future' }
  const minutes = Math.floor((now - time) / 60000)
  if (minutes < 60) return { state: 'ago', value: -minutes, unit: 'minute' }
  if (minutes < 1440) return { state: 'ago', value: -Math.floor(minutes / 60), unit: 'hour' }
  return { state: 'ago', value: -Math.floor(minutes / 1440), unit: 'day' }
}

// Track drafts for explicit refreshes without scheduling background requests.
export function watchWorkspace(refresh, { doc = document, isBlocked = () => false } = {}) {
  let alive = true,
    running = false
  const drafts = new Set()
  const rememberDraft = (event) => {
    const target = event.target
    if (target?.closest?.('.pms-content form, .pms-content [data-workspace-draft]'))
      drafts.add(target)
  }
  const canApply = () => {
    for (const target of drafts) if (!target.isConnected) drafts.delete(target)
    const focused = doc.activeElement
    return (
      alive &&
      !isBlocked() &&
      !drafts.size &&
      doc.visibilityState !== 'hidden' &&
      !doc.querySelector('[role="dialog"], dialog[open]') &&
      !focused?.matches?.('input, textarea, select, [contenteditable="true"]')
    )
  }
  async function refreshNow() {
    if (running || !canApply()) return false
    running = true
    try {
      await refresh(canApply)
    } catch {
      /* The provider exposes sync errors; keep the last data for retry. */
    } finally {
      running = false
    }
    return true
  }
  doc.addEventListener('input', rememberDraft)
  doc.addEventListener('change', rememberDraft)
  return {
    refresh: refreshNow,
    resetDrafts() {
      drafts.clear()
    },
    stop() {
      alive = false
      drafts.clear()
      doc.removeEventListener('input', rememberDraft)
      doc.removeEventListener('change', rememberDraft)
    },
  }
}
