import { Home, Compass, Search, Library, Settings } from "lucide-react";
import type { Page } from "../../types";
import { useLanguageStore } from "../../store/languageStore";

interface BottomNavProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export default function BottomNav({ currentPage, onNavigate }: BottomNavProps) {
  const { translations: t } = useLanguageStore();

  const navItems: { page: Page; icon: typeof Home; label: string }[] = [
    { page: "home", icon: Home, label: t.sidebar.home },
    { page: "search", icon: Search, label: t.nav.search },
    { page: "browse", icon: Compass, label: t.sidebar.browse },
    { page: "library", icon: Library, label: t.sidebar.yourLibrary },
    { page: "settings", icon: Settings, label: t.sidebar.settings },
  ];

  return (
    <nav 
      className="bottom-nav" 
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="bottom-nav-inner">
        {navItems.map((item) => (
          <button
            key={item.page}
            className={`nav-item ${currentPage === item.page ? "active" : ""}`}
            onClick={() => onNavigate(item.page)}
            aria-current={currentPage === item.page ? "page" : undefined}
          >
            <div className="nav-item-content">
              <item.icon 
                size={22} 
                strokeWidth={currentPage === item.page ? 2.5 : 2}
              />
              <span>{item.label}</span>
            </div>
          </button>
        ))}
      </div>
    </nav>
  );
}
