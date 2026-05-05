import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Enable server-side rendering optimization
  experimental: {
    // Allow server actions
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },

  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },

  // Environment compat
  env: {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || 'TradeMind',
  },

  // Image domains for external avatars
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },
}

export default nextConfig

# bumped: 2026-05-05T04:21:00