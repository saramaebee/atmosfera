// Inline SVG icons. Lucide-style strokes, 16px viewport. Pure JSX so we
// don't add another runtime dep. Keep this small — add only what's used.

interface IconProps {
  size?: number;
}

function svg(props: IconProps, children: unknown) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {children}
    </svg>
  );
}

export const Icon = {
  Mark: (p: IconProps) =>
    svg(p, [
      <path d="M3 17c2-4 4-4 6-2s4 2 6-2 4-4 6-2" />,
      <path d="M3 11c2-4 4-4 6-2s4 2 6-2 4-4 6-2" opacity="0.5" />,
    ]),
  Home: (p: IconProps) =>
    svg(p, [
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
      <polyline points="9 22 9 12 15 12 15 22" />,
    ]),
  Layers: (p: IconProps) =>
    svg(p, [
      <polygon points="12 2 2 7 12 12 22 7 12 2" />,
      <polyline points="2 17 12 22 22 17" />,
      <polyline points="2 12 12 17 22 12" />,
    ]),
  ScrollText: (p: IconProps) =>
    svg(p, [
      <path d="M15 12h-5" />,
      <path d="M15 8h-5" />,
      <path d="M19 17V5a2 2 0 0 0-2-2H4" />,
      <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />,
    ]),
  Settings: (p: IconProps) =>
    svg(p, [
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />,
      <circle cx="12" cy="12" r="3" />,
    ]),
  Shield: (p: IconProps) =>
    svg(
      p,
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />,
    ),
  Users: (p: IconProps) =>
    svg(p, [
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />,
      <circle cx="9" cy="7" r="4" />,
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />,
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />,
    ]),
  User: (p: IconProps) =>
    svg(p, [
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />,
      <circle cx="12" cy="7" r="4" />,
    ]),
  Sparkles: (p: IconProps) =>
    svg(p, [
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />,
      <path d="M20 3v4" />,
      <path d="M22 5h-4" />,
    ]),
  LogOut: (p: IconProps) =>
    svg(p, [
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />,
      <polyline points="16 17 21 12 16 7" />,
      <line x1="21" y1="12" x2="9" y2="12" />,
    ]),
  Arrow: (p: IconProps) =>
    svg(p, [<line x1="5" y1="12" x2="19" y2="12" />, <polyline points="12 5 19 12 12 19" />]),
  Crown: (p: IconProps) =>
    svg(
      p,
      <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" />,
    ),
  Inbox: (p: IconProps) =>
    svg(p, [
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />,
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />,
    ]),
};
