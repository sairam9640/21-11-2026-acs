import React from 'react';
import { LucideIcon } from 'lucide-react';

export interface StatCardProps {
  title: string;
  value: string | number | React.ReactNode;
  subtitle?: string;
  icon: LucideIcon;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  variant?: 'sky' | 'emerald' | 'amber' | 'rose' | 'purple' | 'slate';
  onClick?: () => void;
  gradient?: boolean;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  variant = 'sky',
  onClick,
  gradient = true,
}) => {
  const gradientStyles = {
    sky: 'bg-gradient-to-br from-[#1E56A0] via-[#16407B] to-[#11315E]',
    emerald: 'bg-gradient-to-br from-[#059669] via-[#047857] to-[#065F46]',
    amber: 'bg-gradient-to-br from-[#D97706] via-[#B45309] to-[#92400E]',
    rose: 'bg-gradient-to-br from-[#DC2626] via-[#B91C1C] to-[#991B1B]',
    purple: 'bg-gradient-to-br from-[#7C3AED] via-[#6D28D9] to-[#5B21B6]',
    slate: 'bg-gradient-to-br from-[#334155] via-[#1E293B] to-[#0F172A]',
  };

  const titleColors = {
    sky: 'text-blue-200',
    emerald: 'text-emerald-200',
    amber: 'text-amber-200',
    rose: 'text-rose-200',
    purple: 'text-purple-200',
    slate: 'text-slate-300',
  };

  if (gradient) {
    return (
      <div
        onClick={onClick}
        className={`relative overflow-hidden rounded-2xl p-5 text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 ${gradientStyles[variant]} ${
          onClick ? 'cursor-pointer hover:shadow-lg' : ''
        }`}
      >
        <div className="relative z-10 space-y-1">
          <h4 className="text-3xl font-extrabold tracking-tight font-sans text-white">
            {value}
          </h4>
          <p className={`text-xs uppercase tracking-wider font-bold ${titleColors[variant]}`}>
            {title}
          </p>
          {subtitle && (
            <p className={`text-[11px] font-medium opacity-90 ${titleColors[variant]}`}>
              {subtitle}
            </p>
          )}
          {trend && (
            <div className="pt-1.5 flex items-center space-x-1">
              <span className="text-[10px] font-bold text-white/95 bg-white/20 px-2 py-0.5 rounded-full backdrop-blur-xs">
                {trend.isPositive ? '↑' : '↓'} {trend.value}
              </span>
            </div>
          )}
        </div>
        <Icon className="absolute right-3 top-3 w-20 h-20 text-white/10 -mr-2 -mt-2 pointer-events-none" />
      </div>
    );
  }

  const iconColors = {
    sky: 'text-[#1677FF] bg-[#EFF6FF] border-[#BFDBFE]',
    emerald: 'text-[#10B981] bg-[#ECFDF5] border-[#A7F3D0]',
    amber: 'text-[#F59E0B] bg-[#FFFBEB] border-[#FDE68A]',
    rose: 'text-[#EF4444] bg-[#FEF2F2] border-[#FECACA]',
    purple: 'text-[#8B5CF6] bg-[#F5F3FF] border-[#DDD6FE]',
    slate: 'text-[#475569] bg-[#F8FAFC] border-[#E2E8F0]',
  };

  return (
    <div
      onClick={onClick}
      className={`bg-white border border-[#E2E8F0] hover:border-[#CBD5E1] rounded-2xl p-5 transition shadow-xs ${
        onClick ? 'cursor-pointer hover:shadow-sm' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">{title}</span>
        <div className={`p-2.5 rounded-lg border ${iconColors[variant]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-2xl font-bold text-[#0F172A] tracking-tight">{value}</span>
        {trend && (
          <span
            className={`text-xs font-semibold ${
              trend.isPositive ? 'text-[#10B981]' : 'text-[#EF4444]'
            }`}
          >
            {trend.isPositive ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
      {subtitle && <p className="mt-1 text-xs text-[#64748B]">{subtitle}</p>}
    </div>
  );
};
