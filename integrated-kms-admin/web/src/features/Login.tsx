import { FormEvent, useState } from 'react'
import { LockIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { useAuthStore } from '@/stores/auth'

export default function Login() {
  const [userId, setUserId] = useState('admin')
  const [password, setPassword] = useState('')
  const login = useAuthStore((state) => state.login)
  const loading = useAuthStore((state) => state.loading)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await login(userId, password)
    } catch {
      toast.error('로그인에 실패했습니다.')
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'radial-gradient(1200px 500px at 50% -10%, var(--accent-soft), var(--bg-canvas) 60%)'
      }}
    >
      <div className="fadein" style={{ width: '100%', maxWidth: 400 }}>
        <div className="col" style={{ alignItems: 'center', marginBottom: 22 }}>
          <img src="/assets/logo-lbucess.png" alt="LBUCESS" style={{ height: 38 }} />
        </div>
        <div className="card" style={{ padding: 30, boxShadow: 'var(--shadow-2)' }}>
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--fg-primary)', letterSpacing: '-0.01em' }}>
              통합 지식 어드민
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              계정으로 로그인하세요.
            </div>
          </div>
          <form className="col" style={{ gap: 14 }} onSubmit={onSubmit}>
            <label className="field">
              <span>아이디</span>
              <div style={{ position: 'relative' }}>
                <UsersIcon
                  className="size-4"
                  style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)', pointerEvents: 'none' }}
                  aria-hidden="true"
                />
                <Input style={{ paddingLeft: 40 }} value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="아이디" />
              </div>
            </label>
            <label className="field">
              <span>비밀번호</span>
              <div style={{ position: 'relative' }}>
                <LockIcon
                  className="size-4"
                  style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)', pointerEvents: 'none' }}
                  aria-hidden="true"
                />
                <Input
                  style={{ paddingLeft: 40 }}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  placeholder="비밀번호"
                />
              </div>
            </label>
            <label className="check" style={{ marginTop: 2 }}>
              <input type="checkbox" defaultChecked /> 로그인 상태 유지
            </label>
            <Button className="btn-block" style={{ height: 42, marginTop: 4 }} type="submit" disabled={loading}>
              로그인
            </Button>
          </form>
        </div>
      </div>
    </main>
  )
}
