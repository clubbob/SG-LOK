"use client";

import React, { useId } from 'react';
import { DATE_INPUT_PICKER_CLASS, tryOpenDatePicker } from '@/lib/dateInput';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  warning?: boolean; // helperText를 빨간색으로 표시
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    { className, type, label, error, helperText, warning, id, onClick, onFocus, onMouseDown, onPointerDown, ...props },
    ref
  ) => {
    const generatedId = useId();
    const inputId = id || generatedId;
    const isDate = type === 'date';

    const openPickerIfDate = (el: HTMLInputElement, defaultPrevented: boolean) => {
      if (isDate && !defaultPrevented) {
        tryOpenDatePicker(el);
      }
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
      onPointerDown?.(e);
      if (isDate && e.button === 0) {
        openPickerIfDate(e.currentTarget, e.defaultPrevented);
      }
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
      onMouseDown?.(e);
      if (isDate) {
        openPickerIfDate(e.currentTarget, e.defaultPrevented);
      }
    };

    const handleClick = (e: React.MouseEvent<HTMLInputElement>) => {
      onClick?.(e);
      openPickerIfDate(e.currentTarget, e.defaultPrevented);
    };


    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {label}
          </label>
        )}
        <input
          type={type}
          className={cn(
            'flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            isDate && DATE_INPUT_PICKER_CLASS,
            error && 'border-red-500 focus-visible:ring-red-500',
            className
          )}
          ref={ref}
          id={inputId}
          {...props}
          onPointerDown={isDate ? handlePointerDown : onPointerDown}
          onMouseDown={isDate ? handleMouseDown : onMouseDown}
          onClick={isDate ? handleClick : onClick}
          onFocus={onFocus}
          value={props.value !== undefined ? props.value : ''}
        />
        {error && (
          <p className="mt-1 text-sm text-red-600">{error}</p>
        )}
        {helperText && !error && (
          <p className={cn(
            "mt-1 text-sm",
            warning ? "text-red-600" : "text-gray-500"
          )}>{helperText}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input };

