import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/** Inline 24 px stroke icon shell (feather-style, inherits currentColor). */
function IconOutline({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SessionsIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </IconOutline>
  );
}

export function WorkspaceIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </IconOutline>
  );
}

export function ExtensionsIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </IconOutline>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </IconOutline>
  );
}

export function ContextIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </IconOutline>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <path d="m9 18 6-6-6-6" />
    </IconOutline>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <path d="m6 9 6 6 6-6" />
    </IconOutline>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </IconOutline>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </IconOutline>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </IconOutline>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </IconOutline>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </IconOutline>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </IconOutline>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <path d="m15 18-6-6 6-6" />
    </IconOutline>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <IconOutline {...props}>
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </IconOutline>
  );
}
