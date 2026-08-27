import { cn, isComponentType } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }> | React.ReactNode;
  breadcrumb?: Array<{ label: string; href?: string }>;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
  /**
   * ruoyi: 小标题、无图标色块、无面包屑（顶栏已提供面包屑）
   * default: 大标题 + 图标色块，保留给仪表盘等驾驶舱页面
   */
  variant?: 'ruoyi' | 'default';
}

/**
 * RuoYi 风格页面头部：一行小标题 + 副标题 + 右侧 actions。
 * 兼容旧 default 变体（图标色块 + 面包屑），供 dashboard 等特殊页面使用。
 */
export function PageHeader({
  title,
  subtitle,
  icon,
  breadcrumb,
  actions,
  className,
  children,
  variant = 'ruoyi',
}: PageHeaderProps) {
  if (variant === 'ruoyi') {
    return (
      <div
        className={cn(
          'flex flex-wrap items-start justify-between gap-2 border-b border-border bg-card px-4 py-3',
          className,
        )}
      >
        <div className="min-w-0">
          <h1 className="text-[16px] font-medium leading-6 text-foreground">{title}</h1>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
        {children && <div className="w-full">{children}</div>}
      </div>
    );
  }

  const isComp = isComponentType(icon);
  const IconNode = isComp ? (icon as React.ComponentType<{ className?: string }>) : null;
  const iconNode = isComp ? null : (icon as React.ReactNode);
  return (
    <div className={cn('border-b border-border bg-card px-6 py-4', className)}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          {breadcrumb.map((item, idx) => (
            <span key={idx} className="flex items-center gap-1.5">
              {idx > 0 && <span className="text-border">/</span>}
              <span className={idx === breadcrumb.length - 1 ? 'text-foreground/80' : ''}>
                {item.label}
              </span>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand/10 text-brand">
              {IconNode ? <IconNode className="h-5 w-5" /> : iconNode}
            </div>
          )}
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
