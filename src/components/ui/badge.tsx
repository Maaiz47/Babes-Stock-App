import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'outline';
}

export function Badge({ children, className, variant = 'default' }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border',
        variant === 'default' ? 'bg-violet-500/15 text-violet-400 border-violet-500/30' : 'border-white/20 text-gray-400',
        className
      )}
    >
      {children}
    </span>
  );
}
