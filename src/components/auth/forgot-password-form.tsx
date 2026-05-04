'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Loader2, ArrowLeft, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'

const schema = z.object({
  email: z.string().email('Email inválido'),
})
type FormData = z.infer<typeof schema>

export function ForgotPasswordForm() {
  const supabase = createClient()
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    setIsLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) { toast.error(error.message); return }
      setSent(true)
    } catch {
      toast.error('Error al enviar el correo')
    } finally {
      setIsLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="w-full max-w-sm">
        <div className="glass rounded-2xl p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <Mail className="w-6 h-6 text-emerald-400" />
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Email enviado</h2>
          <p className="text-sm text-gray-400 mb-6">
            Revisa tu correo para continuar con la recuperación de contraseña.
          </p>
          <Link href="/login" className="text-sm text-emerald-400 hover:text-emerald-300 flex items-center justify-center gap-2">
            <ArrowLeft className="w-4 h-4" /> Volver al inicio
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <div className="glass rounded-2xl p-8">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-white">Recuperar contraseña</h1>
          <p className="text-sm text-gray-400 mt-1">Te enviaremos un enlace por email</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
            <input
              type="email"
              autoComplete="email"
              placeholder="trader@email.com"
              {...register('email')}
              className={cn(
                'w-full px-3.5 py-2.5 bg-gray-800/50 border rounded-lg text-sm text-white placeholder-gray-600 outline-none transition-colors',
                'focus:border-emerald-500 focus:bg-gray-800',
                errors.email ? 'border-red-500' : 'border-gray-700'
              )}
            />
            {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email.message}</p>}
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-cyan-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</> : 'Enviar enlace'}
          </button>
        </form>

        <div className="text-center mt-6">
          <Link href="/login" className="text-sm text-gray-500 hover:text-gray-300 flex items-center justify-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  )
}
