import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  breadcrumb?: Array<{ label: string; href?: string }>;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * 信息化风格的页面头部：
 * - 顶部面包屑（小字）
 * - 左侧大标题 + 副标题 + 图标底色块
 * - 右侧 actions 区
 */
export function PageHeader({ title, subtitle, icon: Icon, breadcrumb, actions, className }: PageHeaderProps) {
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
          {Icon && (
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand/10 text-brand">
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
