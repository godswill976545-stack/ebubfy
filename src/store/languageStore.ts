import { create } from "zustand";
import type { Translations } from "../i18n/en";
import en from "../i18n/en";
import fr from "../i18n/fr";

export type Locale = "en" | "fr";

interface LanguageState {
  locale: Locale;
  translations: Translations;
  setLocale: (locale: Locale) => void;
}

const translationsMap: Record<Locale, Translations> = { en, fr };

const getInitialLocale = (): Locale => {
  try {
    return (localStorage.getItem("ebubfy-locale") as Locale) || "en";
  } catch {
    return "en";
  }
};

export const useLanguageStore = create<LanguageState>((set) => ({
  locale: getInitialLocale(),
  translations: translationsMap[getInitialLocale()],
  setLocale: (locale) => {
    localStorage.setItem("ebubfy-locale", locale);
    set({ locale, translations: translationsMap[locale] });
  },
}));
