import React, { useEffect, useState, useRef } from 'react';

export interface AnimatedCounterProps {
  value: number;
  formatter?: (val: number) => string;
  className?: string;
  highlightOnChange?: boolean;
}

export const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  value,
  formatter = (v) => v.toLocaleString(),
  className = '',
  highlightOnChange = true,
}) => {
  const [displayValue, setDisplayValue] = useState<number>(value);
  const [isChanging, setIsChanging] = useState<boolean>(false);
  const prevValueRef = useRef<number>(value);

  useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      setDisplayValue(value);
      if (highlightOnChange) {
        setIsChanging(true);
        const timer = setTimeout(() => setIsChanging(false), 900);
        return () => clearTimeout(timer);
      }
    }
  }, [value, highlightOnChange]);

  return (
    <span
      className={`inline-block transition-all duration-300 transform ${
        isChanging ? 'scale-105 text-emerald-300 font-extrabold filter drop-shadow-sm' : ''
      } ${className}`}
    >
      {formatter(displayValue)}
    </span>
  );
};
