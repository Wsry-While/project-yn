import { cn } from '@/lib/utils';

/**
 * 键盘按键样式：用于展示快捷键（如 ⌘K、Esc）。
 * 仅做视觉呈现，不绑定任何行为。
 */
export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 select-none items-center justify-center rounded border border-border/70 bg-muted px-1.5 font-mono text-[10px] font-medium leading-none text-muted-foreground',
        'shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
