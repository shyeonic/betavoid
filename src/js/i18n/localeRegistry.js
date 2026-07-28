import { en } from "./locales/en.js";
import { ko } from "./locales/ko.js";

export const DEFAULT_LOCALE = "en";
export const FALLBACK_LOCALE = "en";
export const LOCALE_STORAGE_KEY = "beta-void-locale";

export const MESSAGES = {
  en,
  ko
};

export const SUPPORTED_LOCALES = Object.keys(MESSAGES);
