import type { SupabaseClient } from '@supabase/supabase-js';
import type { DictOption } from './types';

export type DictOptionRow = {
  id: string;
  category: string;
  value: string;
  aliases: string[];
  sort_order: number;
  active: boolean;
  source: string;
  created_at: string;
  updated_at: string;
};

export function mapDictOption(row: DictOptionRow): DictOption {
  return {
    id: row.id,
    category: row.category,
    value: row.value,
    aliases: row.aliases ?? [],
    sortOrder: row.sort_order,
    active: row.active,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeValue(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * 字典服务：管理跨业务表的枚举值（行业、需求类型、产品、学校层级、建设专业 等）。
 *
 * 推送时使用 normalize()：拿到原始中文字符串，先查 aliases/value 命中已有标准值，
 * 未命中则自动登记一条新 option（自学习），便于后续在管理台合并/重命名。
 */
export class DictService {
  constructor(private readonly db: SupabaseClient) {}

  async listCategory(category: string): Promise<DictOption[]> {
    const { data, error } = await this.db
      .from('dict_options')
      .select('*')
      .eq('category', category)
      .order('sort_order', { ascending: true })
      .order('value');
    if (error) throw new Error(`查询字典失败: ${error.message}`);
    return (data as DictOptionRow[]).map(mapDictOption);
  }

  async listAll(): Promise<DictOption[]> {
    const { data, error } = await this.db
      .from('dict_options')
      .select('*')
      .order('category')
      .order('sort_order');
    if (error) throw new Error(`查询字典失败: ${error.message}`);
    return (data as DictOptionRow[]).map(mapDictOption);
  }

  async findByValue(category: string, value: string): Promise<DictOption | null> {
    const v = normalizeValue(value);
    if (!v) return null;
    const { data, error } = await this.db
      .from('dict_options')
      .select('*')
      .eq('category', category)
      .eq('value', v)
      .maybeSingle<DictOptionRow>();
    if (error) throw new Error(`查询字典失败: ${error.message}`);
    return data ? mapDictOption(data) : null;
  }

  /**
   * 把外部原始值归一到字典标准值；未命中时自动登记。
   * 返回标准 value 字符串。
   */
  async normalize(
    category: string,
    rawValue: string | null | undefined,
    opts: { autoRegister?: boolean; source?: string } = {},
  ): Promise<string | null> {
    const v = normalizeValue(rawValue);
    if (!v) return null;
    const autoRegister = opts.autoRegister !== false;

    // 1) 精确匹配 value
    const exact = await this.findByValue(category, v);
    if (exact) return exact.value;

    // 2) 匹配 aliases
    const { data: byAlias } = await this.db
      .from('dict_options')
      .select('*')
      .eq('category', category)
      .contains('aliases', [v])
      .maybeSingle<DictOptionRow>();
    if (byAlias) return byAlias.value;

    // 3) 自学习登记
    if (autoRegister) {
      const { data, error } = await this.db
        .from('dict_options')
        .insert({
          category,
          value: v,
          aliases: [],
          source: opts.source ?? 'chaoxing',
          active: true,
        })
        .select()
        .single<DictOptionRow>();
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          const raced = await this.findByValue(category, v);
          if (raced) return raced.value;
        }
        // 登记失败不阻塞业务流程，降级返回原始值
        return v;
      }
      return data.value;
    }
    return v;
  }

  /** 数组版：多选值批量归一 */  async normalizeMany(
    category: string,
    rawValues: Array<string | null | undefined> | null | undefined,
    opts: { autoRegister?: boolean; source?: string } = {},
  ): Promise<string[]> {
    if (!Array.isArray(rawValues)) return [];
    const out: string[] = [];
    for (const item of rawValues) {
      const norm = await this.normalize(category, item, opts);
      if (norm && !out.includes(norm)) out.push(norm);
    }
    return out;
  }

  async addAlias(category: string, value: string, alias: string): Promise<void> {
    const a = normalizeValue(alias);
    if (!a) return;
    const opt = await this.findByValue(category, value);
    if (!opt) throw new Error(`字典值不存在: ${category}/${value}`);
    if (opt.aliases.includes(a)) return;
    await this.db
      .from('dict_options')
      .update({ aliases: [...opt.aliases, a] })
      .eq('id', opt.id);
  }

  async rename(category: string, oldValue: string, newValue: string): Promise<void> {
    const v = normalizeValue(newValue);
    if (!v) throw new Error('新值不能为空');
    const opt = await this.findByValue(category, oldValue);
    if (!opt) throw new Error(`字典值不存在: ${category}/${oldValue}`);
    await this.db.from('dict_options').update({ value: v }).eq('id', opt.id);
  }

  /**
   * 合并：把 sourceValue 合并到 targetValue。
   * 业务表中的标准化字段值需要调用方自行批量替换（由迁移/回填脚本处理）。
   */
  async merge(category: string, sourceValue: string, targetValue: string): Promise<void> {
    const source = await this.findByValue(category, sourceValue);
    const target = await this.findByValue(category, targetValue);
    if (!source || !target) throw new Error('源或目标字典值不存在');
    const mergedAliases = Array.from(
      new Set([...target.aliases, source.value, ...source.aliases].filter((a) => a !== target.value)),
    );
    await this.db.from('dict_options').update({ aliases: mergedAliases }).eq('id', target.id);
    await this.db.from('dict_options').update({ active: false }).eq('id', source.id);
  }

  async setActive(category: string, value: string, active: boolean): Promise<void> {
    const opt = await this.findByValue(category, value);
    if (!opt) return;
    await this.db.from('dict_options').update({ active }).eq('id', opt.id);
  }

  /** 管理台：按分类列出（含停用），返回值按 sort_order/value 排序。 */
  async adminList(category?: string): Promise<DictOption[]> {
    let q = this.db.from('dict_options').select('*');
    if (category) q = q.eq('category', category);
    const { data, error } = await q.order('category').order('sort_order', { ascending: true }).order('value');
    if (error) throw new Error(`查询字典失败: ${error.message}`);
    return (data as DictOptionRow[]).map(mapDictOption);
  }

  /** 管理台：按 id 更新 value / aliases / sort_order / active。 */
  async updateById(
    id: string,
    patch: { value?: string; aliases?: string[]; sortOrder?: number; active?: boolean },
  ): Promise<DictOption> {
    const row: Record<string, unknown> = {};
    if (patch.value !== undefined) {
      const v = normalizeValue(patch.value);
      if (!v) throw Object.assign(new Error('字典值不能为空'), { status: 400, code: 'invalid_param' });
      row.value = v;
    }
    if (patch.aliases !== undefined) {
      row.aliases = Array.from(
        new Set(
          patch.aliases
            .map((a) => normalizeValue(a))
            .filter((a): a is string => !!a),
        ),
      );
    }
    if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
    if (patch.active !== undefined) row.active = patch.active;

    const { data, error } = await this.db
      .from('dict_options')
      .update(row)
      .eq('id', id)
      .select()
      .single<DictOptionRow>();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        throw Object.assign(new Error('同分类下已存在相同的字典值'), { status: 409, code: 'duplicate' });
      }
      throw new Error(`更新字典失败: ${error.message}`);
    }
    return mapDictOption(data);
  }

  /** 管理台：新增一条字典值。 */
  async create(input: {
    category: string;
    value: string;
    aliases?: string[];
    sortOrder?: number;
    source?: string;
  }): Promise<DictOption> {
    const category = normalizeValue(input.category);
    const value = normalizeValue(input.value);
    if (!category || !value) {
      throw Object.assign(new Error('分类和字典值不能为空'), { status: 400, code: 'invalid_param' });
    }
    const aliases = Array.from(
      new Set((input.aliases ?? []).map((a) => normalizeValue(a)).filter((a): a is string => !!a)),
    );
    const { data, error } = await this.db
      .from('dict_options')
      .insert({
        category,
        value,
        aliases,
        sort_order: input.sortOrder ?? 0,
        active: true,
        source: input.source ?? 'manual',
      })
      .select()
      .single<DictOptionRow>();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        throw Object.assign(new Error('同分类下已存在相同的字典值'), { status: 409, code: 'duplicate' });
      }
      throw new Error(`新增字典失败: ${error.message}`);
    }
    return mapDictOption(data);
  }
}
