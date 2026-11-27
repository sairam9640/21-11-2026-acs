import React from 'react';

export interface Column<T> {
  header: React.ReactNode;
  accessor?: keyof T | ((item: T) => React.ReactNode);
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  isLoading?: boolean;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  isLoading,
}: DataTableProps<T>) {
  if (isLoading && data.length === 0) {
    return (
      <div className="w-full py-12 flex flex-col items-center justify-center space-y-3 bg-white border border-[#E2E8F0] rounded-[10px] shadow-xs">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-[#64748B] font-medium animate-pulse">Loading records...</p>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-x-auto border border-[#E2E8F0] rounded-[10px] bg-white shadow-xs">
      {/* Non-intrusive top progress indicator during background refetches */}
      {isLoading && (
        <div className="absolute top-0 left-0 right-0 z-20 h-0.5 overflow-hidden bg-blue-100">
          <div className="h-full w-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 animate-pulse" />
        </div>
      )}
      <table className="w-full text-left text-sm text-[#334155]">
        <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-xs font-semibold text-[#475569] uppercase tracking-wider">
          <tr>
            {columns.map((col, idx) => (
              <th key={idx} className={`px-4 py-3.5 ${col.className || ''}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#EEF2F7]">
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-[#94A3B8]">
                No matching records found.
              </td>
            </tr>
          ) : (
            data.map((item) => (
              <tr
                key={keyExtractor(item)}
                onClick={() => onRowClick && onRowClick(item)}
                className={`hover:bg-[#F8FAFC] transition ${
                  onRowClick ? 'cursor-pointer' : ''
                }`}
              >
                {columns.map((col, idx) => (
                  <td key={idx} className={`px-4 py-3 text-[#334155] ${col.className || ''}`}>
                    {typeof col.accessor === 'function'
                      ? col.accessor(item)
                      : col.accessor
                      ? (item[col.accessor] as any)
                      : null}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
