'use client';
import { forwardRef } from 'react';
import { Calendar, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DateInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  value: string;
  onChange: (val: string) => void;
  onClear?: () => void;
  clearable?: boolean;
}

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, onClear, clearable, className, ...props }, ref) => (
    <div className="relative flex items-center">
      <Calendar size={14} className="absolute left-3 text-gray-500 pointer-events-none z-10" />
      <input
        ref={ref}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-8 py-2 text-base sm:text-sm text-gray-100',
          'focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-colors',
          '[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer',
          className
        )}
        style={{ fontSize: '16px' }}
        {...props}
      />
      {clearable && value && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); (onClear ?? (() => onChange('')))(); }}
          className="absolute right-2 z-10 p-0.5 rounded text-gray-500 hover:text-gray-200 hover:bg-white/10 transition-colors"
          aria-label="Clear date"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
);
DateInput.displayName = 'DateInput';
