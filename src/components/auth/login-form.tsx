'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'

const schema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
})

type FormData = z.infer<typeof schema>

export function LoginForm() {
  const router = useRouter()
  const supabase = createClient()
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setIsLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      })

      if (error) {
        toast.error(error.message === 'Invalid login credentials'
          ? 'Credenciales incorrectas'
          : error.message
        )
        return
      }

      toast.success('Bienvenido a TradeMind')
      router.push('/dashboard')
      router.refresh()
    } catch {
      toast.error('Error al iniciar sesión')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="glass rounded-2xl p-8">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-white">Iniciar sesión</h1>
          <p className="text-sm text-gray-400 mt-1">Accede a tu plataforma de trading</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Email
            </label>
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
            {errors.email && (
              <p className="mt-1 text-xs text-red-400">{errors.email.message}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-medium text-gray-400">Contraseña</label>
              <Link href="/forgot-password" className="text-xs text-emerald-400 hover:text-emerald-300">
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                {...register('password')}
                className={cn(
                  'w-full px-3.5 py-2.5 bg-gray-800/50 border rounded-lg text-sm text-white placeholder-gray-600 outline-none transition-colors pr-10',
                  'focus:border-emerald-500 focus:bg-gray-800',
                  errors.password ? 'border-red-500' : 'border-gray-700'
                )}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && (
              <p className="mt-1 text-xs text-red-400">{errors.password.message}</p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2 mt-2"
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Ingresando...</>
            ) : (
              'Iniciar sesión'
            )}
          </button>
        </form>

        {/* Register link */}
        <p className="text-center text-sm text-gray-500 mt-6">
          ¿No tienes cuenta?{' '}
          <Link href="/register" className="text-emerald-400 hover:text-emerald-300 font-medium">
            Regístrate
          </Link>
        </p>
      </div>
    </div>
  )
}

# bumped: 2026-05-05T04:21:00