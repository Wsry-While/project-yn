import type { SessionUser } from '@/lib/supabase-auth';
import UserAvatar from '@/components/user-avatar';

interface UserProfileProps {
  user: SessionUser;
}

export default function UserProfile({ user }: UserProfileProps) {
  const { chaoxing, profile } = user;
  // displayName 优先取可信的 app_metadata，缺失时才回落到用户可改写的展示资料。
  const displayName = chaoxing.displayName || profile.displayName;

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <UserAvatar avatarUrl={profile.avatar} displayName={displayName} />
      <div className="min-w-0">
        <p className="truncate text-lg font-semibold text-card-foreground">
          {displayName}
          {chaoxing.uid && (
            <span className="ml-1 font-mono text-sm font-normal text-muted-foreground">
              （{chaoxing.uid}）
            </span>
          )}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {chaoxing.orgName || '未知机构'}
          {chaoxing.fid && <span className="font-mono">（{chaoxing.fid}）</span>}
        </p>
      </div>
    </div>
  );
}
