import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, icon, ...props }, ref) => {
  if (icon) {
    return (
      <div className="relative flex items-center">
        <span className="absolute left-3 text-gray-500 pointer-events-none">{icon}</span>
        <input
          ref={ref}
          className={cn(
            'w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-base sm:text-sm text-gray-100 placeholder:text-gray-500',
            'focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-colors',
            className
          )}
          {...props}
        />
      </div>
    );
  }
  return (
    <input
      ref={ref}
      className={cn(
        'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-base sm:text-sm text-gray-100 placeholder:text-gray-500',
        'focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-colors',
        className
      )}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export { Input };
