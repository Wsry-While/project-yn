import type { SupabaseClient } from '@supabase/supabase-js';
import type { TripOptionDict } from '@/lib/domain/types';
import { mapTripOptionDict, type TripOptionDictRow } from '@/lib/domain/mappers';

export class OptionDictionaryService {
  constructor(private readonly db: SupabaseClient) {}

  async list(fieldKey?: string, activeOnly = true): Promise<TripOptionDict[]> {
    let q = this.db.from('trip_option_dict').select('*').order('sort_order').order('source_value');
    if (fieldKey) q = q.eq('field_key', fieldKey);
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return (data as TripOptionDictRow[]).map(mapTripOptionDict);
  }

  /**
   * 确保字典中存在某个外部选项值。未知值自动登记并启用，颜色留空，后续运营可在设置中调整。
   */
  async ensure(fieldKey: string, sourceValue: string, label?: string): Promise<void> {
    const value = sourceValue.trim();
    if (!value) return;
    const { data } = await this.db
      .from('trip_option_dict')
      .select('id')
      .eq('field_key', fieldKey)
      .eq('source_value', value)
      .maybeSingle();
    if (data?.id) return;

    const { error } = await this.db.from('trip_option_dict').insert({
      field_key: fieldKey,
      source_value: value,
      label: (label ?? value).slice(0, 100),
      is_active: true,
      sort_order: 999,
    });
    if (error && (error as { code?: string }).code !== '23505') throw error;
  }

  async ensureMany(fieldKey: string, values: string[]): Promise<void> {
    for (const value of values) {
      await this.ensure(fieldKey, value);
    }
  }
}
