import { Home, Compass, Library, Settings, Sun, Moon, Sparkles } from "lucide-react";
import type { Page, Theme } from "../../types";
import { useThemeStore } from "../../store/themeStore";
import { useLanguageStore } from "../../store/languageStore";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export default function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const { translations: t } = useLanguageStore();
  const { theme, setTheme } = useThemeStore();

  const nextTheme: Theme = theme === "light" ? "dark" : theme === "dark" ? "midnight" : "light";
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Sparkles;
  const themeLabel = theme === "light" ? t.sidebar.lightMode : theme === "dark" ? t.sidebar.darkMode : t.sidebar.midnightMode;

  const navItems: { page: Page; icon: typeof Home; label: string }[] = [
    { page: "home", icon: Home, label: t.sidebar.home },
    { page: "browse", icon: Compass, label: t.sidebar.browse },
    { page: "library", icon: Library, label: t.sidebar.yourLibrary },
    { page: "settings", icon: Settings, label: t.sidebar.settings },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <img src="/logo.png" alt="ebubfy" width="32" height="32" style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }} />
          </div>
          <span>ebubfy</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.page}
            className={`sidebar-nav-item ${currentPage === item.page ? "active" : ""}`}
            onClick={() => onNavigate(item.page)}
          >
            <div className="sidebar-nav-icon">
              <item.icon size={20} strokeWidth={currentPage === item.page ? 2.5 : 2} />
            </div>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button 
          className="sidebar-theme-toggle" 
          onClick={() => setTheme(nextTheme)}
          title={themeLabel}
          aria-label={themeLabel}
        >
          <ThemeIcon size={16} />
          <span>{themeLabel}</span>
        </button>
      </div>
    </aside>
  );
}
