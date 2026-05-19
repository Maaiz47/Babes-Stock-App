'use client';
import { useState, useEffect } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { useToast } from './ui/toast';
import { generateStockNumber, cn } from '@/lib/utils';
import type { StockItem, StockItemInput, StockStatus } from '@/lib/types';
import { Wand2 } from 'lucide-react';
import { HistoryPanel } from './HistoryPanel';

interface FormData {
  stock_number: string;
  name: string;
  description: string;
  category: string;
  rack_number: string;
  quantity: string;
  physical_quantity: string;
  status: StockStatus;
  date_added: string;
  date_removed: string;
  released_to: string;
  received_by: string;
  stored_by: string;
  notes: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  item?: StockItem | null;
}

const today = new Date().toISOString().split('T')[0];

export function StockForm({ open, onClose, onSaved, item }: Props) {
  const isEdit = !!item;
  const { error: toastError, success } = useToast();
  const [saving, setSaving] = useState(false);

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<FormData>({
    defaultValues: {
      stock_number: '',
      name: '',
      description: '',
      category: '',
      rack_number: '',
      quantity: '0',
      physical_quantity: '',
      status: 'in-stock',
      date_added: today,
      date_removed: '',
      released_to: '',
      received_by: '',
      stored_by: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (open) {
      if (item) {
        reset({
          stock_number: item.stock_number,
          name: item.name,
          description: item.description ?? '',
          category: item.category ?? '',
          rack_number: item.rack_number ?? '',
          quantity: String(item.quantity),
          physical_quantity: item.physical_quantity != null ? String(item.physical_quantity) : '',
          status: item.status,
          date_added: item.date_added,
          date_removed: item.date_removed ?? '',
          released_to: item.released_to ?? '',
          received_by: item.received_by ?? '',
          stored_by: item.stored_by ?? '',
          notes: item.notes ?? '',
        });
      } else {
        reset({
          stock_number: generateStockNumber(),
          name: '',
          description: '',
          category: '',
          rack_number: '',
          quantity: '0',
          physical_quantity: '',
          status: 'in-stock',
          date_added: today,
          date_removed: '',
          released_to: '',
          received_by: '',
          stored_by: '',
          notes: '',
        });
      }
    }
  }, [open, item, reset]);

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    setSaving(true);
    try {
      const payload: StockItemInput = {
        ...data,
        quantity: Number(data.quantity),
        physical_quantity: data.physical_quantity != null ? Number(data.physical_quantity) : null,
        description: data.description || undefined,
        category: data.category || undefined,
        rack_number: data.rack_number || undefined,
        date_removed: data.date_removed || null,
        released_to: data.released_to || null,
        received_by: data.received_by || null,
        stored_by: data.stored_by || null,
        notes: data.notes || null,
      };

      const url = isEdit ? `/api/stock/${item!.id}` : '/api/stock';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error || 'Failed to save');
      success(isEdit ? 'Item updated' : 'Item created', data.name);
      onSaved();
      onClose();
    } catch (e) {
      toastError('Save failed', String(e));
    } finally {
      setSaving(false);
    }
  };

  const status = watch('status');

  const Field = ({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-[11px] text-gray-600">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Stock Item' : 'Add Stock Item'}
      size="2xl"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Stock Number *" error={errors.stock_number?.message}>
            <div className="flex gap-2">
              <Input {...register('stock_number')} placeholder="STK-001" className="flex-1" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Auto-generate"
                onClick={() => setValue('stock_number', generateStockNumber())}
              >
                <Wand2 size={14} />
              </Button>
            </div>
          </Field>
          <Field label="Name *" error={errors.name?.message}>
            <Input {...register('name')} placeholder="Item name" />
          </Field>
        </div>

        <Field label="Description" error={errors.description?.message}>
          <textarea
            {...register('description')}
            placeholder="Optional description"
            rows={2}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-colors resize-none"
          />
        </Field>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Category">
            <Input {...register('category')} placeholder="e.g. Electronics" />
          </Field>
          <Field label="Rack Number">
            <Input {...register('rack_number')} placeholder="e.g. A-12" />
          </Field>
          <Field label="Status">
            <Select {...register('status')} value={status}>
              <option value="in-stock">In Stock</option>
              <option value="low-stock">Low Stock</option>
              <option value="reserved">Reserved</option>
              <option value="removed">Removed</option>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="System Quantity *" hint="Official record count · adjust via +/− quick action on the table" error={errors.quantity?.message}>
            <Input type="number" min={0} {...register('quantity')} />
          </Field>
          <Field label="Physical Count" hint="Actual counted qty · leave blank until a count is done" error={errors.physical_quantity?.message}>
            <Input
              type="number"
              min={0}
              {...register('physical_quantity')}
              placeholder="Leave blank if not yet counted"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date Added *" error={errors.date_added?.message}>
            <Input type="date" {...register('date_added')} />
          </Field>
          <Field label="Stored By" hint="Who placed this item into storage">
            <Input {...register('stored_by')} placeholder="Name" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Received By" hint="Who signed for or took physical delivery of this item">
            <Input {...register('received_by')} placeholder="Name" />
          </Field>
        </div>

        {/* Removal details — relevant when status is Removed */}
        <div className={cn('rounded-xl border px-4 py-3 space-y-3 transition-colors', status === 'removed' ? 'border-amber-500/25 bg-amber-500/4' : 'border-white/6 bg-white/2 opacity-60')}>
          <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
            Release / Removal details
            {status !== 'removed' && <span className="ml-2 normal-case text-gray-600 font-normal">· auto-filled when you use Remove Stock action</span>}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date Removed" hint="When the item left inventory">
              <Input type="date" {...register('date_removed')} />
            </Field>
            <Field label="Released To" hint="Who received or took this stock">
              <Input {...register('released_to')} placeholder="Name" />
            </Field>
          </div>
        </div>

        <Field label="Notes">
          <textarea
            {...register('notes')}
            placeholder="Any additional notes"
            rows={2}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-colors resize-none"
          />
        </Field>

        {isEdit && item && <HistoryPanel itemId={item.id} />}

        <div className="flex gap-3 justify-end pt-2 border-t border-white/8">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update Item' : 'Add Item'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
