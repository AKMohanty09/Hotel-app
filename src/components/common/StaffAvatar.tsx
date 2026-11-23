import React from 'react';

interface StaffAvatarProps {
  name: string;
  photoUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<StaffAvatarProps['size']>, string> = {
  xs: 'h-7 w-7 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-xs',
  lg: 'h-14 w-14 text-sm',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'ST';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const StaffAvatar: React.FC<StaffAvatarProps> = ({
  name,
  photoUrl,
  size = 'md',
  className = '',
}) => {
  const dim = SIZE_CLASSES[size];
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        referrerPolicy="no-referrer"
        className={`${dim} rounded-full object-cover border border-slate-200 dark:border-slate-700 bg-white shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      aria-label={name}
      className={`${dim} rounded-full bg-orange-100 dark:bg-royal/30 text-orange-800 dark:text-lavender border border-orange-200 dark:border-royal/40 flex items-center justify-center font-semibold shrink-0 select-none ${className}`}
    >
      {getInitials(name)}
    </div>
  );
};
