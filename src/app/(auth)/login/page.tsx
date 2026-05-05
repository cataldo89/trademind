import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/login-form'

export const metadata: Metadata = { title: 'Iniciar sesión' }

export default function LoginPage() {
  return <LoginForm />
}

# bumped: 2026-05-05T04:21:00