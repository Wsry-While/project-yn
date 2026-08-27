/**
 * 批量分析真实招标文件的章节结构。
 *
 * 运行：pnpm tsx scripts/analyze-tender-structure.ts [--limit=N] [--save]
 *
 * 对每条有招标文件的 bidding_screenshots 记录：
 *  1. 下载并解析招标文件（pdf/docx/doc 均支持）
 *  2. 抽取前 8000 字 + 关键章节的局部文本
 *  3. 让 LLM 输出章节结构 + 评分办法/采购需求所在章节
 *  4. 把结果写入 tender_structure_analysis 表（--save）并在最后汇总
 *
 * 跑完后打印统计：章节标题变体、评分/采购需求章节的常见位置、
 * 章节内的稳定锚点等，用于重写抽取规则。
 */
import { createClient } from "@supabase/supabase-js";
import { LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { parseAssetDocument, parseDocumentFromUrl } from "../src/lib/domain/parse/document-parser";
import { normalizeFile as parseAssetRef } from "../src/lib/domain/bidding-normalize";
import { getModelForScenario } from "../src/lib/domain/llm-prompts";

// ---------- 极简 Supabase admin ----------
const supabaseUrl = process.env.COZE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("缺少 COZE_SUPABASE_URL / COZE_SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// ---------- 极简 LLM ----------
function getModelForAnalysis(): string {
  return getModelForScenario("bidding-score");
}
async function callLlm(prompt: string, attempt = 1): Promise<string> {
  const client = new LLMClient(new Config({ timeout: 120_000 }), undefined);
  const messages = [{ role: "user" as const, content: prompt }];
  let out = "";
  let lastError: unknown = null;
  try {
    const stream = client.stream(messages, {
      model: getModelForAnalysis(),
      temperature: 0.05,
    });
    for await (const part of stream) {
      // coze-coding-dev-sdk 返回 LangChain AIMessageChunk，content 在顶层；
      // 可能是 string，也可能是结构化 content parts 数组
      const c = (part as { content?: unknown })?.content;
      if (typeof c === "string") out += c;
      else if (Array.isArray(c)) {
        for (const seg of c) {
          if (seg && typeof seg === "object") {
            const s = seg as Record<string, unknown>;
            if (typeof s.text === "string") out += s.text;
            else if (typeof s.content === "string") out += s.content;
          }
        }
      }
    }
  } catch (e) {
    lastError = e;
  }
  out = out.trim();
  if (!out && attempt < 3) {
    console.warn(`   ⚠ 第 ${attempt} 次调用返回空${lastError ? `（${(lastError as Error).message}）` : ""}，2s 后重试...`);
    await new Promise((r) => setTimeout(r, 2000));
    return callLlm(prompt, attempt + 1);
  }
  if (lastError) throw lastError;
  return out;
}

// ---------- DDL（表已通过 exec_sql 创建；脚本只在 --save 时写入）----------
async function ensureTable(): Promise<void> {
  // 表结构通过 migrations 维护，这里仅做连通性校验
  const { error } = await supabase.from("tender_structure_analysis").select("id").limit(1);
  if (error) console.warn("[warn] tender_structure_analysis 不可写：", error.message);
}

// ---------- 章节结构 prompt ----------
function buildStructurePrompt(fileName: string, headText: string, middleText: string): string {
  return `你是招投标文件结构分析专家。下面是一份真实招标文件的部分文本（开头 + 中部抽样，已截断）。请定位关键章节。

【文件名】
${fileName}

【开头部分，通常含目录】
"""
${headText}
"""

【中部抽样，可能含采购需求/评分办法】
"""
${middleText}
"""

请严格只输出一个 JSON，字段：
{
  "chapters": [
    {"title": "章节完整标题", "approxLocation": "开头/前1/3/中部/后1/3/结尾", "keywordHits": ["命中的关键锚点"]}
  ],
  "scoringSection": "评分办法/评标办法/磋商方法所在章节的完整标题；找不到给 null",
  "requirementsSection": "采购需求/项目需求/技术要求所在章节的完整标题；找不到给 null",
  "scoringAnchors": ["评分办法章节里出现的锚点词，如 评分因素、满分、评分表、技术部分评分、商务部分评分、▲"],
  "requirementsAnchors": ["采购需求章节里出现的锚点词，如 技术要求一览表、参数表、功能要求、▲"],
  "notes": "任何结构上的观察，不超过 100 字"
}

要求：
1. 章节标题必须按文件实际写法，不要自己编造；
2. 如果目录里能看到章节标题，直接采用；
3. 评分办法常见标题：磋商方法、评标办法、评审办法、综合评分法、评分标准、评分细则；
4. 采购需求常见标题：项目需求、采购需求、技术要求、货物需求、服务要求、采购需求及技术要求；
5. 不要输出 JSON 以外的内容。`;
}

function safeJsonParse<T = unknown>(text: string): T | null {
  if (!text) return null;
  // 去掉 ```json ... ``` 包裹
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned) as T; } catch { /* ignore */ }
  // 截取第一个 { 到最后一个 }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)) as T; } catch { /* ignore */ }
  }
  return null;
}

// ---------- 主流程 ----------
async function parseForRecord(fileRef: any): Promise<{ text: string; kind: string } | null> {
  const ref = parseAssetRef(fileRef);
  if (ref?.assetId) {
    try {
      return await parseAssetDocument(ref.assetId);
    } catch (e) {
      console.warn("[warn] asset 解析失败，回退直链：", (e as Error).message);
    }
  }
  if (ref?.url) {
    try {
      return await parseDocumentFromUrl(ref.url);
    } catch (e) {
      console.warn("[warn] url 解析失败：", (e as Error).message);
      return null;
    }
  }
  return null;
}

function pickSample(full: string): { head: string; middle: string } {
  // 章节结构主要看目录和评分/需求章节，不需要喂完整正文
  // 开头 4000 字（含目录） + 45%~65% 处 4000 字（覆盖采购需求/评分办法）
  const head = full.slice(0, 4000);
  const midStart = Math.floor(full.length * 0.45);
  const middle = full.slice(midStart, midStart + 4000);
  return { head, middle };
}

type StructureResult = {
  chapters?: Array<{ title: string; approxLocation?: string; keywordHits?: string[] }>;
  scoringSection?: string | null;
  requirementsSection?: string | null;
  scoringAnchors?: string[];
  requirementsAnchors?: string[];
  notes?: string;
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const save = args.includes("--save");
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 100;

  if (save) await ensureTable();

  const { data: rows, error } = await supabase
    .from("bidding_screenshots")
    .select("id, project_name, project_bidding_file, submission_date")
    .not("project_bidding_file", "is", null)
    .is("deleted_at", null)
    .order("submission_date", { ascending: false })
    .limit(limit);
  if (error) throw error;

  console.log(`\n共 ${rows?.length ?? 0} 条待分析，开始处理...\n`);

  const results: Array<{ record: any; parsed: boolean; kind?: string; length?: number; structure?: StructureResult | null; error?: string }> = [];

  for (let i = 0; i < (rows?.length ?? 0); i++) {
    const row = rows![i];
    process.stdout.write(`[${i + 1}/${rows!.length}] ${row.project_name?.slice(0, 40)} ... `);
    try {
      const parsed = await parseForRecord(row.project_bidding_file);
      if (!parsed) {
        console.log("❌ 解析失败");
        results.push({ record: row, parsed: false, error: "parse failed" });
        continue;
      }
      console.log(`✓ ${parsed.kind} ${parsed.text.length} 字，调用 LLM 标注结构...`);
      const { head, middle } = pickSample(parsed.text);
      const fileName = row.project_bidding_file?.name || row.project_bidding_file?.fileName || "招标文件";
      const raw = await callLlm(buildStructurePrompt(fileName, head, middle));
      const structure = safeJsonParse<StructureResult>(raw);
      if (!structure) {
        console.log("   ⚠ LLM 返回非 JSON，原文 200 字：", raw.slice(0, 200));
      } else {
        console.log(`   评分章节：${structure.scoringSection ?? "未找到"}`);
        console.log(`   需求章节：${structure.requirementsSection ?? "未找到"}`);
      }
      results.push({ record: row, parsed: true, kind: parsed.kind, length: parsed.text.length, structure });

      if (save && structure) {
        await supabase.from("tender_structure_analysis").insert({
          record_id: row.id,
          file_name: fileName,
          file_kind: parsed.kind,
          file_length: parsed.text.length,
          chapters: structure.chapters ?? null,
          scoring_section: structure.scoringSection ?? null,
          requirements_section: structure.requirementsSection ?? null,
          anchors: { scoring: structure.scoringAnchors ?? [], requirements: structure.requirementsAnchors ?? [] },
          notes: structure.notes ?? null,
          raw_response: raw,
        });
      }
    } catch (e) {
      console.log("❌ 异常：", (e as Error).message);
      results.push({ record: row, parsed: false, error: (e as Error).message });
    }
    // 轻微节流，避免 LLM 限流
    await new Promise((r) => setTimeout(r, 500));
  }

  // ---------- 汇总统计 ----------
  console.log("\n========== 汇总 ==========\n");
  const ok = results.filter((r) => r.parsed && r.structure);
  const parsed = results.filter((r) => r.parsed);
  console.log(`解析成功：${parsed.length}/${results.length}`);
  console.log(`LLM 标注成功：${ok.length}/${results.length}\n`);

  const counter = (key: "scoringSection" | "requirementsSection") => {
    const m = new Map<string, number>();
    for (const r of ok) {
      const v = (r.structure as any)?.[key];
      if (v) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  console.log("--- 评分办法章节标题统计 ---");
  for (const [title, count] of counter("scoringSection")) console.log(`  ${count}\t${title}`);
  console.log("\n--- 采购需求章节标题统计 ---");
  for (const [title, count] of counter("requirementsSection")) console.log(`  ${count}\t${title}`);

  const anchorCounter = (key: "scoringAnchors" | "requirementsAnchors") => {
    const m = new Map<string, number>();
    for (const r of ok) {
      const list: string[] = (r.structure as any)?.[key] ?? [];
      for (const a of list) m.set(a, (m.get(a) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  };

  console.log("\n--- 评分章节 Top 20 锚点词 ---");
  for (const [a, n] of anchorCounter("scoringAnchors")) console.log(`  ${n}\t${a}`);
  console.log("\n--- 采购需求章节 Top 20 锚点词 ---");
  for (const [a, n] of anchorCounter("requirementsAnchors")) console.log(`  ${n}\t${a}`);

  // 失败案例
  const failed = results.filter((r) => !r.parsed);
  if (failed.length) {
    console.log(`\n--- 解析失败 ${failed.length} 条 ---`);
    for (const f of failed) console.log(`  - ${f.record.project_name}: ${f.error ?? "未知原因"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
