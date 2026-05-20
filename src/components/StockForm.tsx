'use client';
import { useState, useEffect } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { DateInput } from './ui/date-input';
import { Select } from './ui/select';
import { useToast } from './ui/toast';
import { generateStockNumber, toISODate, formatDateSmart } from '@/lib/utils';
import type { StockItem, StockItemInput, StockStatus } from '@/lib/types';
import { Wand2, Info } from 'lucide-react';
import { HistoryPanel } from './HistoryPanel';

interface FormData {
  stock_number: string;
  name: string;
  description: string;
  category: string;
  location: string;
  rack_number: string;
  quantity: string;
  physical_quantity: string;
  status: StockStatus;
  date_added: string;
  received_by: string;
  stored_by: string;
  notes: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  item?: StockItem | null;
  template?: StockItem | null;
  locations?: string[];
}

const today = new Date().toISOString().split('T')[0];

export function StockForm({ open, onClose, onSaved, item, template, locations = [] }: Props) {
  const isEdit = !!item;
  const { error: toastError, success } = useToast();
  const [saving, setSaving] = useState(false);

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<FormData>({
    defaultValues: {
      stock_number: '',
      name: '',
      description: '',
      category: '',
      location: '',
      rack_number: '',
      quantity: '0',
      physical_quantity: '',
      status: 'in-stock',
      date_added: today,
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
          location: item.location ?? '',
          rack_number: item.rack_number ?? '',
          quantity: String(item.quantity),
          physical_quantity: item.physical_quantity != null ? String(item.physical_quantity) : '',
          status: item.status,
          date_added: item.date_added,
          received_by: item.received_by ?? '',
          stored_by: item.stored_by ?? '',
          notes: item.notes ?? '',
        });
      } else if (template) {
        reset({
          stock_number: generateStockNumber(),
          name: template.name,
          description: template.description ?? '',
          category: template.category ?? '',
          location: template.location ?? '',
          rack_number: template.rack_number ?? '',
          quantity: '0',
          physical_quantity: '',
          status: template.status,
          date_added: new Date().toISOString().split('T')[0],
          received_by: '',
          stored_by: template.stored_by ?? '',
          notes: template.notes ?? '',
        });
      } else {
        reset({
          stock_number: generateStockNumber(),
          name: '',
          description: '',
          category: '',
          location: '',
          rack_number: '',
          quantity: '0',
          physical_quantity: '',
          status: 'in-stock',
          date_added: new Date().toISOString().split('T')[0],
          received_by: '',
          stored_by: '',
          notes: '',
        });
      }
    }
  }, [open, item, template, reset]);

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    setSaving(true);
    try {
      const payload: Omit<StockItemInput, 'date_removed' | 'released_to'> & { date_removed?: null; released_to?: null } = {
        stock_number: data.stock_number,
        name: data.name,
        description: data.description || undefined,
        category: data.category || undefined,
        location: data.location || null,
        rack_number: data.rack_number || undefined,
        quantity: Number(data.quantity),
        physical_quantity: data.physical_quantity !== '' ? Number(data.physical_quantity) : null,
        status: data.status,
        date_added: data.date_added,
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
      title={isEdit ? 'Edit Stock Item' : template ? `Duplicate — ${template.name}` : 'Add Stock Item'}
      size="2xl"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-base sm:text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-colors resize-none"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Location" hint="Warehouse or office where this item is stored">
            <input
              type="text"
              list="locations-list"
              {...register('location')}
              placeholder="e.g. Warehouse A"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-base sm:text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-colors"
            />
            <datalist id="locations-list">
              {locations.map(l => <option key={l} value={l} />)}
            </datalist>
          </Field>
          <Field label="Category">
            <Input {...register('category')} placeholder="e.g. Electronics" />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Rack Number">
            <Input {...register('rack_number')} placeholder="e.g. A-12" />
          </Field>
          <Field label="Status">
            <Select {...register('status')}>
              <option value="in-stock">In Stock</option>
              <option value="low-stock">Low Stock</option>
              <option value="reserved">Reserved</option>
              <option value="removed">Removed</option>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Date Added *" error={errors.date_added?.message} hint={watch('date_added') ? formatDateSmart(watch('date_added')) : undefined}>
            <DateInput value={watch('date_added') || ''} onChange={(v) => setValue('date_added', v, { shouldDirty: true })} />
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {([
                { label: 'Today', offset: 0 },
                { label: 'Yesterday', offset: -1 },
                { label: '−7d', offset: -7 },
                { label: '−30d', offset: -30 },
              ] as { label: string; offset: number }[]).map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    const d = new Date(); d.setDate(d.getDate() + p.offset);
                    setValue('date_added', toISODate(d), { shouldDirty: true });
                  }}
                  className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors border border-white/8"
                >{p.label}</button>
              ))}
            </div>
          </Field>
          <Field label="Stored By" hint="Who placed this item into storage">
            <Input {...register('stored_by')} placeholder="Name" />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Received By" hint="Who signed for or took physical delivery of this item">
            <Input {...register('received_by')} placeholder="Name" />
          </Field>
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-white/3 border border-white/8 px-3 py-2.5">
          <Info size={13} className="text-gray-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-gray-500">Release &amp; removal details (date removed, released to) are recorded automatically when you use the <strong className="text-gray-400">Remove Stock</strong> action in Quick Adjust.</p>
        </div>

        <Field label="Notes">
          <textarea
            {...register('notes')}
            placeholder="Any additional notes"
            rows={2}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-base sm:text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-colors resize-none"
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
