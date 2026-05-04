import { cn } from '@/lib/utils'

interface SkeletonCardProps {
  className?: string
}

export function SkeletonCard({ className }: SkeletonCardProps) {
  return (
    <div className={cn('glass rounded-xl animate-pulse', className)}>
      <div className="p-5 space-y-3">
        <div className="h-4 w-32 bg-gray-800 rounded" />
        <div className="h-3 w-full bg-gray-800/60 rounded" />
        <div className="h-3 w-2/3 bg-gray-800/60 rounded" />
      </div>
    </div>
  )
}
