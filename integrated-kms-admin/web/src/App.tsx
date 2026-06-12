import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ChartNoAxesColumnIncreasingIcon,
  BellIcon,
  ClipboardListIcon,
  DatabaseIcon,
  FolderTreeIcon,
  KeyRoundIcon,
  LogOutIcon,
  NetworkIcon,
  PanelLeftIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  UsersIcon
} from 'lucide-react'
import { Toaster } from 'sonner'
import Login from '@/features/Login'
import IntegratedSearch from '@/features/IntegratedSearch'
import { Categories, ExternalClients, Jobs, KnowledgeManagement, Stats, SystemStatus, Tenants, Users } from '@/features/AdminSections'
import { publicAsset } from '@/lib/assets'
import { useAuthStore } from '@/stores/auth'
import { NavKey, canSeeNav, navGroups, navItems } from '@/navigation'

const icons: Record<NavKey, typeof SearchIcon> = {
  search: SearchIcon,
  knowledge: DatabaseIcon,
  categories: FolderTreeIcon,
  stats: ChartNoAxesColumnIncreasingIcon,
  tenants: NetworkIcon,
  users: UsersIcon,
  external: KeyRoundIcon,
  jobs: ClipboardListIcon,
  system: SettingsIcon
}

function roleLabel(role?: string) {
  if (role === 'admin') return '시스템 관리자'
  if (role === 'manager') return '지식 관리자'
  return '일반 사용자'
}

function roleBadgeClass(role?: string) {
  if (role === 'admin') return 'badge blue'
  if (role === 'manager') return 'badge green'
  return 'badge gray'
}

function RoleIcon({ role }: { role?: string }) {
  if (role === 'admin') return <ShieldIcon className="size-3" />
  if (role === 'manager') return <DatabaseIcon className="size-3" />
  return <UsersIcon className="size-3" />
}

export default function App() {
  const [active, setActive] = useState<NavKey>('search')
  const [mountedViews, setMountedViews] = useState<Set<NavKey>>(() => new Set(['search']))
  const [collapsed, setCollapsed] = useState(false)
  const contentRef = useRef<HTMLElement | null>(null)
  const scrollPositions = useRef<Partial<Record<NavKey, { left: number; top: number }>>>({})
  const user = useAuthStore((state) => state.user)
  const load = useAuthStore((state) => state.load)
  const logout = useAuthStore((state) => state.logout)

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    document.body.setAttribute('data-density', 'regular')
    const root = document.documentElement.style
    root.setProperty('--accent', '#2563eb')
    root.setProperty('--accent-hover', '#1d4fd6')
    root.setProperty('--accent-active', '#1947c0')
    root.setProperty('--accent-soft', '#eef3ff')
    root.setProperty('--accent-ring', 'rgba(37,99,235,.18)')
  }, [])

  useEffect(() => {
    if (user && !canSeeNav(user.role, active)) {
      setActive('search')
    }
  }, [active, user])

  const effectiveActive = user && canSeeNav(user.role, active) ? active : 'search'

  useEffect(() => {
    if (!user) return
    setMountedViews((current) => {
      if (current.has(effectiveActive)) return current
      const next = new Set(current)
      next.add(effectiveActive)
      return next
    })
  }, [effectiveActive, user])

  useLayoutEffect(() => {
    if (!user) return
    const position = scrollPositions.current[effectiveActive] || { top: 0, left: 0 }
    requestAnimationFrame(() => {
      contentRef.current?.scrollTo(position)
    })
  }, [effectiveActive, user])

  function saveCurrentScroll() {
    if (!contentRef.current) return
    scrollPositions.current[effectiveActive] = {
      top: contentRef.current.scrollTop,
      left: contentRef.current.scrollLeft
    }
  }

  function navigateTo(key: NavKey) {
    if (key === effectiveActive) return
    saveCurrentScroll()
    setActive(key)
  }

  function renderView(key: NavKey) {
    switch (key) {
      case 'search':
        return <IntegratedSearch />
      case 'knowledge':
        return <KnowledgeManagement />
      case 'categories':
        return <Categories />
      case 'stats':
        return <Stats />
      case 'tenants':
        return <Tenants />
      case 'users':
        return <Users />
      case 'external':
        return <ExternalClients />
      case 'jobs':
        return <Jobs />
      case 'system':
        return <SystemStatus />
    }
  }

  if (!user) {
    return (
      <>
        <Login />
        <Toaster richColors />
      </>
    )
  }

  const visibleNavItems = navItems.filter((item) => canSeeNav(user.role, item.key))
  const currentRoleLabel = roleLabel(user.role)

  return (
    <div className="app" data-collapsed={collapsed}>
      <aside className="sidebar">
        <div className="sb-brand">
          <img src={publicAsset('assets/logo-lbucess.png')} alt="LBUCESS" className="sb-logo" />
          <img src={publicAsset('assets/logo-lbucess-mark.png')} alt="LBUCESS" className="sb-mark-only" />
        </div>
        <nav className="sb-nav">
          {navGroups.map((group) => (
            <div key={group}>
              <div className="sb-cap">{group}</div>
              {navItems
                .filter((item) => item.group === group && canSeeNav(user.role, item.key))
                .map((item) => {
                  const Icon = icons[item.key]
                  return (
                    <button
                      key={item.key}
                      className={`sb-item ${effectiveActive === item.key ? 'active' : ''}`}
                      onClick={() => navigateTo(item.key)}
                      title={item.label}
                      >
                        <Icon className="ico" />
                        <span className="lbl">{item.label}</span>
                        {'tail' in item && item.tail && <span className="tail">{item.tail}</span>}
                      </button>
                    )
                  })}
            </div>
          ))}
        </nav>
        <div className="sb-foot">
          <div className="sb-user">
            <div className="av">{(user.display_name || user.user_id).slice(0, 1).toUpperCase()}</div>
            <div className="who">
              <b>{user.display_name || user.user_id}</b>
              <span>
                {currentRoleLabel} · {user.role === 'admin' ? '전체' : user.tenant_name || user.kms_workspace || 'base'}
              </span>
            </div>
            <button className="lo" onClick={logout} title="로그아웃">
              <LogOutIcon className="size-4" />
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="tb-toggle" onClick={() => setCollapsed((value) => !value)} title="사이드바">
            <PanelLeftIcon className="size-5" />
          </button>
          <div className="tb-tabs" role="tablist" aria-label="주요 메뉴">
            {visibleNavItems.map((item) => {
              const Icon = icons[item.key]
              const selected = effectiveActive === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`tb-tab${selected ? ' on' : ''}`}
                  onClick={() => navigateTo(item.key)}
                  title={item.description}
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                  {'tail' in item && item.tail && <span className="ct">{item.tail}</span>}
                </button>
              )
            })}
          </div>
          <div className="tb-spacer" />
          <span className={roleBadgeClass(user.role)}>
            <RoleIcon role={user.role} /> {currentRoleLabel}
          </span>
          <span className="tb-pill">
            <span className="dot" /> 시스템 정상
          </span>
          <button className="tb-icon">
            <BellIcon className="size-5" />
            <span className="pip" />
          </button>
        </header>
        <main className="content" ref={contentRef}>
          {visibleNavItems
            .filter((item) => mountedViews.has(item.key))
            .map((item) => (
              <section
                key={item.key}
                className="view-pane"
                hidden={effectiveActive !== item.key}
                aria-hidden={effectiveActive !== item.key}
              >
                {renderView(item.key)}
              </section>
            ))}
        </main>
      </div>
      <Toaster richColors />
    </div>
  )
}
