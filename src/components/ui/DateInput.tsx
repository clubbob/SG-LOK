"use client";

import React, { useId } from 'react';
import { DATE_INPUT_PICKER_CLASS, mergeDatePickerOpenHandlers } from '@/lib/dateInput';
import { cn } from '@/lib/utils';

export interface DateInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  error?: string;
}

const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  (
    {
      className,
      label,
      error,
      id,
      onClick,
      onFocus,
      onMouseDown,
      onPointerDown,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const inputId = id || generatedId;

    const openPicker = (el: HTMLInputElement, defaultPrevented: boolean) => {
      mergeDatePickerOpenHandlers(el, defaultPrevented);
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
      onPointerDown?.(e);
      if (e.button === 0) {
        openPicker(e.currentTarget, e.defaultPrevented);
      }
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
      onMouseDown?.(e);
      openPicker(e.currentTarget, e.defaultPrevented);
    };

    const handleClick = (e: React.MouseEvent<HTMLInputElement>) => {
      onClick?.(e);
      openPicker(e.currentTarget, e.defaultPrevented);
    };

    return (
      <div className={label || error ? 'w-full' : undefined}>
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <input
          type="date"
          id={inputId}
          ref={ref}
          className={cn(
            'flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            DATE_INPUT_PICKER_CLASS,
            error && 'border-red-500 focus-visible:ring-red-500',
            className
          )}
          {...props}
          value={props.value !== undefined ? props.value : ''}
          onPointerDown={handlePointerDown}
          onMouseDown={handleMouseDown}
          onClick={handleClick}
          onFocus={onFocus}
        />
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
    );
  }
);

DateInput.displayName = 'DateInput';

export { DateInput };
