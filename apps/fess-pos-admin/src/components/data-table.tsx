'use client';

import {
  type ColumnDef,
  type FilterFn,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useIsAdvanced } from '@/lib/preferences';
import { cn } from '@/lib/utils';

declare module '@tanstack/react-table' {
  // Type parameters must match the library's declaration for merging.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Classes for this column's body cells. */
    className?: string;
    /** Classes for this column's header cell. */
    headerClassName?: string;
    /** Technical column: shown only in Advanced view (T2-24). */
    advanced?: boolean;
  }
}

export interface DataTableProps<TData, TValue = unknown> {
  /** Column defs — declare as `const columns: ColumnDef<Row>[] = [...]` using accessorKey/accessorFn + cell. */
  columns: ColumnDef<TData, TValue>[];
  data: TData[] | undefined;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Show the global search box (default true). */
  enableSearch?: boolean;
  searchPlaceholder?: string;
  /** Custom row matcher for the search box; default matches any column value (case-insensitive). */
  searchFn?: (row: TData, query: string) => boolean;
  /** Extra controls rendered next to the search box (filters, buttons). */
  toolbar?: ReactNode;
  onRowClick?: (row: TData) => void;
  getRowId?: (row: TData, index: number) => string;
  rowClassName?: (row: TData) => string | undefined;
  initialSorting?: SortingState;
  /** Rows per page (default 50). */
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  /** Adds a checkbox column; selected rows are reported via onSelectionChange. */
  selectable?: boolean;
  onSelectionChange?: (rows: TData[]) => void;
  className?: string;
}

const EMPTY: never[] = [];

/** TanStack Table wrapper: client-side sorting, global search, pagination (50), row click, selection, empty/loading/error states. */
export function DataTable<TData, TValue = unknown>({
  columns,
  data,
  isLoading = false,
  error,
  onRetry,
  enableSearch = true,
  searchPlaceholder = 'Search…',
  searchFn,
  toolbar,
  onRowClick,
  getRowId,
  rowClassName,
  initialSorting = [],
  pageSize = 50,
  emptyTitle = 'Nothing to show',
  emptyDescription,
  selectable = false,
  onSelectionChange,
  className,
}: DataTableProps<TData, TValue>) {
  const rows = data ?? EMPTY;
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const globalFilterFn = useMemo<FilterFn<TData>>(() => {
    if (searchFn) return (row, _columnId, filterValue) => searchFn(row.original, String(filterValue ?? ''));
    return (row, columnId, filterValue) => {
      const q = String(filterValue ?? '').trim().toLowerCase();
      if (!q) return true;
      const v: unknown = row.getValue(columnId);
      if (v === null || v === undefined) return false;
      return (typeof v === 'object' ? JSON.stringify(v) : String(v)).toLowerCase().includes(q);
    };
  }, [searchFn]);

  const advanced = useIsAdvanced();
  // Advanced-only columns stay defined (sorting and search still use them) but are hidden in Basic view.
  const columnVisibility = useMemo<VisibilityState>(() => {
    const out: VisibilityState = {};
    if (advanced) return out;
    for (const c of columns) {
      const id = c.id ?? (c as { accessorKey?: unknown }).accessorKey;
      if (c.meta?.advanced && typeof id === 'string') out[id] = false;
    }
    return out;
  }, [columns, advanced]);
  const allColumns = useMemo<ColumnDef<TData, TValue>[]>(() => {
    if (!selectable) return columns;
    const selectColumn: ColumnDef<TData, TValue> = {
      id: '__select',
      enableSorting: false,
      enableGlobalFilter: false,
      meta: { className: 'w-8', headerClassName: 'w-8' },
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all on this page"
          checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(v === true)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label="Select row"
          checked={row.getIsSelected()}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(v) => row.toggleSelected(v === true)}
        />
      ),
    };
    return [selectColumn, ...columns];
  }, [columns, selectable]);

  const table = useReactTable<TData>({
    data: rows,
    columns: allColumns,
    state: { sorting, globalFilter, pagination, rowSelection, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: selectable,
    globalFilterFn,
    getColumnCanGlobalFilter: () => true,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const selectionCallback = useRef(onSelectionChange);
  selectionCallback.current = onSelectionChange;
  useEffect(() => {
    if (!selectable) return;
    selectionCallback.current?.(table.getSelectedRowModel().rows.map((r) => r.original));
  }, [rowSelection, selectable, table]);

  const filteredCount = table.getFilteredRowModel().rows.length;
  const pageRows = table.getRowModel().rows;
  const { pageIndex } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const from = filteredCount === 0 ? 0 : pageIndex * pagination.pageSize + 1;
  const to = Math.min(filteredCount, (pageIndex + 1) * pagination.pageSize);
  const colSpan = table.getVisibleLeafColumns().length;

  return (
    <div className={cn('space-y-3', className)}>
      {enableSearch || toolbar ? (
        <div className="flex flex-wrap items-center gap-2">
          {enableSearch ? (
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-9"
                aria-label="Search table"
              />
            </div>
          ) : null}
          {toolbar ? <div className="flex flex-1 flex-wrap items-center gap-2">{toolbar}</div> : null}
        </div>
      ) : null}

      {error ? <ApiErrorAlert error={error} onRetry={onRetry} /> : null}

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const content = header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext());
                  return (
                    <TableHead key={header.id} className={header.column.columnDef.meta?.headerClassName}>
                      {canSort && !header.isPlaceholder ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-200/60 hover:text-foreground"
                        >
                          {content}
                          {sorted === 'asc' ? <ArrowUp className="size-3.5" /> : sorted === 'desc' ? <ArrowDown className="size-3.5" /> : <ArrowUpDown className="size-3.5 opacity-40" />}
                        </button>
                      ) : (
                        content
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading && rows.length === 0 ? (
              Array.from({ length: 5 }, (_, i) => (
                <TableRow key={`sk-${i}`}>
                  <TableCell colSpan={colSpan}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="p-0">
                  <EmptyState
                    title={globalFilter ? 'No matches' : emptyTitle}
                    description={globalFilter ? `Nothing matches "${globalFilter}".` : emptyDescription}
                  />
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter') onRowClick(row.original);
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  className={cn(onRowClick && 'cursor-pointer hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none', rowClassName?.(row.original))}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {filteredCount === 0 ? '0 rows' : `${from}–${to} of ${filteredCount}`}
          {selectable && Object.keys(rowSelection).length > 0 ? ` · ${Object.keys(rowSelection).length} selected` : ''}
        </span>
        {pageCount > 1 ? (
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span className="px-2">
              Page {pageIndex + 1} of {pageCount}
            </span>
            <Button type="button" variant="outline" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
