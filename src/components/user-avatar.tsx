'use client';

import { useState } from 'react';

interface UserAvatarProps {
  avatarUrl: string;
  displayName: string;
}

export default function UserAvatar({ avatarUrl, displayName }: UserAvatarProps) {
  const [failed, setFailed] = useState(false);
  const initial = displayName.charAt(0) || '?';

  if (!avatarUrl || failed) {
    return (
      <div className="flex size-16 items-center justify-center rounded-full bg-muted text-xl text-muted-foreground">
        {initial}
      </div>
    );
  }

  return (
    <img
      src={avatarUrl}
      alt={displayName}
      referrerPolicy="no-referrer"
      className="size-16 rounded-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}
