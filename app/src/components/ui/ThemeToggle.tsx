import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type Theme } from '../../lib/theme';

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

// A three-way switch, not a single toggle: "system" is a real, common
// choice (the OS already has a light/dark setting most people picked once
// and never think about again), not just an edge case light/dark skip over.
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Theme">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          className={`theme-toggle__option${theme === value ? ' theme-toggle__option--active' : ''}`}
          onClick={() => setTheme(value)}
        >
          <Icon size={15} />
          {label}
        </button>
      ))}
    </div>
  );
}
