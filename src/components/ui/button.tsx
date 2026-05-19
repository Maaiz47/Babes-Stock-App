'use client';
import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-950 disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-violet-600 hover:bg-violet-500 text-white focus:ring-violet-500 shadow-sm',
        destructive: 'bg-red-600 hover:bg-red-500 text-white focus:ring-red-500 shadow-sm',
        outline: 'border border-white/10 bg-white/5 hover:bg-white/10 text-gray-200 focus:ring-white/30',
        ghost: 'hover:bg-white/8 text-gray-300 hover:text-white focus:ring-white/20',
        secondary: 'bg-white/10 hover:bg-white/15 text-gray-200 focus:ring-white/30',
        success: 'bg-emerald-600 hover:bg-emerald-500 text-white focus:ring-emerald-500 shadow-sm',
        warning: 'bg-amber-600 hover:bg-amber-500 text-white focus:ring-amber-500 shadow-sm',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 px-3 text-xs',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9',
        'icon-sm': 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = 'Button';

export { Button, buttonVariants };
