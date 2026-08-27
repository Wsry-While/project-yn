'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type EditFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime-local'
  | 'boolean'
  | 'select';

export interface EditFieldOption {
  label: string;
  value: string;
}

export interface EditField<T> {
  key: keyof T & string;
  label: string;
  type: EditFieldType;
  options?: EditFieldOption[];
  required?: boolean;
  placeholder?: string;
  help?: string;
  span?: 1 | 2;
  min?: number;
  max?: number;
}

interface EditDrawerProps<T extends Record<string, unknown>> {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  record: T | null;
  fields: Array<EditField<T>>;
  onSubmit: (patch: Partial<T>) => Promise<void>;
}

/**
 * 右侧滑出抽屉，用于超管编辑只读业务表的可纠错字段。
 */
export function EditDrawer<T extends Record<string, unknown>>({
  open,
  onClose,
  title,
  description,
  record,
  fields,
  onSubmit,
}: EditDrawerProps<T>) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !record) return;
    const init: Record<string, unknown> = {};
    for (const f of fields) {
      init[f.key] = record[f.key] ?? null;
    }
    setDraft(init);
    setError(null);
  }, [open, record, fields]);

  if (!open || !record) return null;

  const setField = (k: string, v: unknown) => setDraft((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      for (const f of fields) {
        if (f.required && (draft[f.key] === '' || draft[f.key] === null || draft[f.key] === undefined)) {
          throw new Error(`请填写：${f.label}`);
        }
      }
      await onSubmit(draft as Partial<T>);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[560px] flex-col bg-card shadow-dropdown animate-slide-in-right">
        <div className="flex items-start justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {fields.map((f) => {
            const v = draft[f.key];
            const spanClass = f.span === 2 ? 'sm:col-span-2' : '';
            return (
              <div key={f.key} className={cn('space-y-1.5', spanClass)}>
                <Label className="text-xs font-medium text-muted-foreground">
                  {f.label}
                  {f.required && <span className="ml-0.5 text-status-danger">*</span>}
                </Label>
                {f.type === 'textarea' ? (
                  <Textarea
                    value={(v as string) ?? ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    rows={4}
                    className="rounded-sm text-sm"
                  />
                ) : f.type === 'boolean' ? (
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={Boolean(v)}
                      onChange={(e) => setField(f.key, e.target.checked)}
                    />
                    <span className="text-sm">是</span>
                  </label>
                ) : f.type === 'select' ? (
                  <Select
                    value={v == null ? '__none__' : String(v)}
                    onValueChange={(val) => setField(f.key, val === '__none__' ? null : val)}
                  >
                    <SelectTrigger className="h-8 rounded-sm text-sm">
                      <SelectValue placeholder={f.placeholder ?? '请选择'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">—</SelectItem>
                      {f.options?.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={f.type}
                    value={v == null ? '' : String(v)}
                    min={f.min}
                    max={f.max}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (f.type === 'number') {
                        setField(f.key, raw === '' ? null : Number(raw));
                      } else {
                        setField(f.key, raw);
                      }
                    }}
                    placeholder={f.placeholder}
                    className="h-8 rounded-sm text-sm"
                  />
                )}
                {f.help && <div className="text-[11px] text-muted-foreground">{f.help}</div>}
              </div>
            );
          })}
          {error && (
            <div className="rounded-sm border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" className="rounded-sm" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button size="sm" className="rounded-sm" onClick={submit} disabled={saving}>
            {saving ? '保存中…' : '保存修改'}
          </Button>
        </div>
      </div>
    </div>
  );
}
