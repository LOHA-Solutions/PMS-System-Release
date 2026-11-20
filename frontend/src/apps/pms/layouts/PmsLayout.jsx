import { formatDateTime } from '../../../shared/lib/date.js'
import { t as tUi, tr as labelUi, useI18n } from '../../../shared/i18n/useI18n.js'
import { getIntlLocale } from '../../../shared/i18n/store.js'
import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { usePms } from '../data/usePms'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import RequestActivity from '../../../shared/components/RequestActivity'
import { watchWorkspace, workspaceAge } from '../data/workspaceSync'
import './PmsLayout.css'
import '../components/PmsControls.css'

export function WorkspaceUpdatedAt({ stamp, timezone }) {
  useI18n()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])
  const age = workspaceAge(stamp, now)
  if (age.state === 'unknown') return <span>{tUi('system.manualRefresh')}</span>
  return (
    <span>
      <time dateTime={stamp}>
        {tUi('system.lastUpdated', { time: formatDateTime(stamp, timezone) })}
      </time>
      {' · '}
      {age.state === 'future'
        ? labelUi('Thời điểm cập nhật nằm ở tương lai; kiểm tra đồng hồ thiết bị.')
        : new Intl.RelativeTimeFormat(getIntlLocale(), { numeric: 'auto' }).format(
            age.value,
            age.unit,
          )}
    </span>
  )
}

export default function PmsLayout() {
  useI18n()
  const [mobileMenu, setMobileMenu] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [refreshing, setRefreshing] = useState(false),
    [blockedRefresh, setBlockedRefresh] = useState(null)
  const {
    subscription,
    storageWarning,
    tenantId,
    tenant,
    settings,
    accessDialog,
    authGeneration,
    workspaceLoading,
    pendingRequests,
    workspaceRevision,
    workspaceSyncError,
    writeReceipt,
    lastSyncedAt,
    refreshWorkspace,
  } = usePms()
  const { pathname } = useLocation()
  const menuRef = useRef(null)
  const syncControl = useRef(null),
    syncState = useRef(null)
  const refreshKey = JSON.stringify([tenantId, authGeneration, pathname, workspaceRevision])
  useEffect(() => {
    syncState.current = { workspaceLoading, pendingRequests, accessDialog }
  }, [workspaceLoading, pendingRequests, accessDialog])
  useEffect(() => {
    if (!tenantId) return
    const control = watchWorkspace((canApply) => refreshWorkspace({ quiet: true, canApply }), {
      isBlocked: () =>
        syncState.current.workspaceLoading ||
        syncState.current.pendingRequests.writes > 0 ||
        Boolean(syncState.current.accessDialog),
    })
    syncControl.current = control
    return () => {
      control.stop()
      syncControl.current = null
    }
  }, [tenantId, authGeneration, pathname, refreshWorkspace])
  useEffect(() => {
    syncControl.current?.resetDrafts()
  }, [workspaceRevision])
  async function reloadWorkspace() {
    if (refreshing) return
    setRefreshing(true)
    setBlockedRefresh(null)
    try {
      if ((await syncControl.current?.refresh()) === false) setBlockedRefresh(refreshKey)
    } finally {
      setRefreshing(false)
    }
  }
  useEffect(() => {
    if (mobileMenu && !accessDialog) menuRef.current?.showModal()
    else menuRef.current?.close()
  }, [mobileMenu, accessDialog])
  return (
    <div className={`app-theme pms-shell${isCollapsed ? ' pms-shell-collapsed' : ''}`}>
      <a className="pms-skip-link" href="#pms-main-content">
        {tUi('nav.skip')}
      </a>
      <div className="pms-desktop-navigation">
        <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      </div>
      <dialog
        id="pms-mobile-navigation"
        className="pms-mobile-navigation"
        ref={menuRef}
        aria-label={tUi('nav.hotelMenu')}
        onClick={(event) => {
          if (event.target === event.currentTarget) setMobileMenu(false)
        }}
        onCancel={() => setMobileMenu(false)}
        onClose={() => setMobileMenu(false)}
      >
        <Sidebar onClose={() => setMobileMenu(false)} />
      </dialog>
      <div className="pms-workspace">
        <RequestActivity />
        <Header onOpenNavigation={() => setMobileMenu(true)} />
        <main id="pms-main-content" className="pms-main" tabIndex={-1}>
          <div className="pms-content">
            {subscription?.operationalAccess?.active && (
              <p className="pms-shell-notice" role="status">
                {tUi('billing.operationalAccess', {
                  until: formatDateTime(subscription.operationalAccess.until, settings.timezone),
                })}{' '}
                {tUi('billing.operationalAccessHint')}
              </p>
            )}
            {storageWarning && (
              <p className="pms-shell-notice" role="alert">
                {storageWarning}
              </p>
            )}
            <div className="pms-workspace-refresh">
              <WorkspaceUpdatedAt
                key={JSON.stringify([tenantId, authGeneration, lastSyncedAt])}
                stamp={lastSyncedAt}
                timezone={settings.timezone}
              />
              <button
                type="button"
                disabled={!tenantId || refreshing || workspaceLoading || pendingRequests.writes > 0}
                onClick={reloadWorkspace}
              >
                <RefreshCw size={16} aria-hidden="true" />
                {refreshing ? tUi('common.loading') : tUi('system.reloadData')}
              </button>
            </div>
            {blockedRefresh === refreshKey && (
              <p className="pms-shell-notice" role="status">
                {tUi('system.refreshBlocked')}
              </p>
            )}
            {writeReceipt?.tenantId === tenantId && !writeReceipt.synchronized ? (
              <p className="pms-shell-notice" role="status">
                {tUi(
                  writeReceipt.id ? 'system.writeSavedPendingWithId' : 'system.writeSavedPending',
                  { id: writeReceipt.id },
                )}
              </p>
            ) : (
              workspaceSyncError && (
                <p className="pms-shell-notice" role="status">
                  {tUi('system.syncError')}
                </p>
              )
            )}
            {tenant && tenant.status?.toUpperCase() !== 'ACTIVE' && (
              <p className="pms-shell-notice" role="status">
                {tUi('system.suspended')}
              </p>
            )}
            <Outlet key={JSON.stringify([tenantId, authGeneration, pathname])} />
          </div>
        </main>
      </div>
    </div>
  )
}
