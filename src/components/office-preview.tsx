'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * 基于开源库的 Office 文档纯前端预览。
 *
 * - .docx → docx-preview（Apache-2.0）把文档渲染为 HTML
 * - .xls/.xlsx/.csv → SheetJS（xlsx，Apache-2.0）解析为 HTML 表格
 * - .doc/.ppt/.pptx 等无成熟纯前端开源渲染方案 → 提供下载兜底
 *
 * 解析库按需动态 import，不进入首屏 bundle。
 */

type OfficeKind = 'docx' | 'xlsx' | 'unsupported';

function getKind(fileName: string | undefined | null): OfficeKind {
  const name = (fileName || '').toLowerCase();
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) return 'xlsx';
  return 'unsupported';
}

export function OfficePreview({
  src,
  fileName,
  downloadUrl,
  nonce,
}: {
  src: string;
  fileName: string | null;
  downloadUrl: string;
  nonce: number;
}) {
  const kind = getKind(fileName);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; message?: string }>({
    status: 'idle',
  });

  useEffect(() => {
    if (kind === 'unsupported') return;
    let cancelled = false;

    const run = async () => {
      setState({ status: 'loading' });
      try {
        const url = `${src}${src.includes('?') ? '&' : '?'}_=${nonce}`;
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`文件加载失败（${res.status}）`);
        const blob = await res.blob();

        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = '';

        if (kind === 'docx') {
          const { renderAsync } = await import('docx-preview');
          await renderAsync(blob, containerRef.current, undefined, {
            inWrapper: true,
            breakPages: true,
            ignoreHeight: false,
            ignoreWidth: false,
            className: 'docx-wrapper',
            trimXmlDeclaration: true,
            useBase64URL: true,
          } as Parameters<typeof renderAsync>[3]);
        } else {
          const XLSX = await import('xlsx');
          const buf = await blob.arrayBuffer();
          const wb = XLSX.read(buf, { type: 'array' });
          const root = document.createElement('div');
          root.className = 'xlsx-book';
          wb.SheetNames.forEach((sheetName) => {
            const ws = wb.Sheets[sheetName];
            const heading = document.createElement('div');
            heading.className = 'xlsx-sheet-name';
            heading.textContent = sheetName;
            root.appendChild(heading);
            const html = XLSX.utils.sheet_to_html(ws, { editable: false });
            const wrap = document.createElement('div');
            wrap.className = 'xlsx-sheet';
            // sheet_to_html 返回 <table>...</table>，包一层用于横向滚动
            wrap.innerHTML = html;
            root.appendChild(wrap);
          });
          containerRef.current.appendChild(root);
        }

        if (!cancelled) setState({ status: 'done' });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : '文档解析失败',
          });
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [src, nonce, kind]);

  if (kind === 'unsupported') {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground/60" />
        <p className="max-w-md text-sm text-muted-foreground">
          该格式（{fileName ? fileName.split('.').pop()?.toUpperCase() : 'doc/ppt'}）暂无成熟的浏览器内开源预览方案，建议下载后使用本地 Office/WPS 打开。
        </p>
        <a href={downloadUrl} target="_blank" rel="noreferrer">
          <Button size="sm">
            <Download className="mr-1 h-3.5 w-3.5" />
            下载文件
          </Button>
        </a>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="office-preview-container max-h-[70vh] overflow-auto rounded-md border bg-white p-4"
      />
      {state.status === 'loading' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-background/80 text-sm text-muted-foreground backdrop-blur-sm">
          <Loader2 className="h-5 w-5 animate-spin text-brand" />
          正在解析文档…
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{state.message || '文档解析失败'}</span>
          <a href={downloadUrl} target="_blank" rel="noreferrer" className="ml-auto">
            <Button size="sm" variant="outline">
              <Download className="mr-1 h-3.5 w-3.5" />
              下载
            </Button>
          </a>
        </div>
      ) : null}
    </div>
  );
}
