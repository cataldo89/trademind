'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const schema = z.object({
  fullName: z.string().min(2, 'Ingresa tu nombre completo'),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Las contraseñas no coinciden',
  path: ['confirmPassword'],
})

type FormData = z.infer<typeof schema>

export function RegisterForm() {
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
      const { error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: { full_name: data.fullName },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (error) {
        toast.error(error.message)
        return
      }

      toast.success('¡Cuenta creada! Revisa tu email para confirmar.')
      router.push('/login')
    } catch {
      toast.error('Error al crear la cuenta')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="glass rounded-2xl p-8">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-white">Crear cuenta</h1>
          <p className="text-sm text-gray-400 mt-1">Únete a TradeMind</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {[
            { name: 'fullName', label: 'Nombre completo', type: 'text', placeholder: 'Juan Pérez', autoComplete: 'name' },
            { name: 'email', label: 'Email', type: 'email', placeholder: 'trader@email.com', autoComplete: 'email' },
          ].map((field) => (
            <div key={field.name}>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                {field.label}
              </label>
              <input
                type={field.type}
                autoComplete={field.autoComplete}
                placeholder={field.placeholder}
                {...register(field.name as keyof FormData)}
                className={cn(
                  'w-full px-3.5 py-2.5 bg-gray-800/50 border rounded-lg text-sm text-white placeholder-gray-600 outline-none transition-colors',
                  'focus:border-emerald-500 focus:bg-gray-800',
                  errors[field.name as keyof FormData] ? 'border-red-500' : 'border-gray-700'
                )}
              />
              {errors[field.name as keyof FormData] && (
                <p className="mt-1 text-xs text-red-400">
                  {errors[field.name as keyof FormData]?.message}
                </p>
              )}
            </div>
          ))}

          {/* Password */}
          {(['password', 'confirmPassword'] as const).map((field) => (
            <div key={field}>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                {field === 'password' ? 'Contraseña' : 'Confirmar contraseña'}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  {...register(field)}
                  className={cn(
                    'w-full px-3.5 py-2.5 bg-gray-800/50 border rounded-lg text-sm text-white placeholder-gray-600 outline-none transition-colors pr-10',
                    'focus:border-emerald-500 focus:bg-gray-800',
                    errors[field] ? 'border-red-500' : 'border-gray-700'
                  )}
                />
                {field === 'password' && (
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                )}
              </div>
              {errors[field] && (
                <p className="mt-1 text-xs text-red-400">{errors[field]?.message}</p>
              )}
            </div>
          ))}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2 mt-2"
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Creando cuenta...</>
            ) : (
              'Crear cuenta'
            )}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="text-emerald-400 hover:text-emerald-300 font-medium">
            Inicia sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
