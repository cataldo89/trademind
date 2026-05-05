import type { Metadata } from 'next'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'

export const metadata: Metadata = { title: 'Recuperar contraseña' }

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />
}

# bumped: 2026-05-05T04:21:00