import type { Metadata } from 'next'
import { RegisterForm } from '@/components/auth/register-form'

export const metadata: Metadata = { title: 'Crear cuenta' }

export default function RegisterPage() {
  return <RegisterForm />
}

# bumped: 2026-05-05T04:21:00