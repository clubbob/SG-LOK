'use client';

import React, { useEffect, useId, useMemo } from 'react';
import {
  productionMachineSelectClassName,
  type ProductionMachine,
} from '@/lib/production/productionMachines';

type ProductionMachineSelectProps = {
  id?: string;
  label?: string;
  value: string;
  onChange: (machineName: string) => void;
  machines: ProductionMachine[];
  loading?: boolean;
  disabled?: boolean;
  required?: boolean;
  onMouseDown?: (e: React.MouseEvent<HTMLSelectElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLSelectElement>) => void;
};

export function ProductionMachineSelect({
  id,
  label = '기계명',
  value,
  onChange,
  machines,
  loading = false,
  disabled = false,
  required = false,
  onMouseDown,
  onClick,
}: ProductionMachineSelectProps) {
  const generatedId = useId();
  const selectId = id || generatedId;

  const registeredNames = useMemo(() => new Set(machines.map((m) => m.machineName)), [machines]);
  const selectValue = useMemo(() => {
    const trimmed = value.trim();
    return trimmed && registeredNames.has(trimmed) ? trimmed : '';
  }, [value, registeredNames]);

  useEffect(() => {
    if (loading) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (registeredNames.has(trimmed)) return;
    onChange('');
  }, [loading, machines, value, registeredNames, onChange]);

  return (
    <div className="w-full">
      <label htmlFor={selectId} className="block text-sm font-medium text-gray-700 mb-2">
        {label}
        {required ? ' *' : ''}
      </label>
      <select
        id={selectId}
        value={selectValue}
        disabled={disabled || loading}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        onMouseDown={onMouseDown}
        onClick={onClick}
        className={productionMachineSelectClassName}
      >
        <option value="">{loading ? '불러오는 중…' : '선택 안함'}</option>
        {machines.map((m) => (
          <option key={m.id} value={m.machineName}>
            {m.machineName}
          </option>
        ))}
      </select>
    </div>
  );
}
