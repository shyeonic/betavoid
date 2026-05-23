import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  LOCALE_STORAGE_KEY,
  MESSAGES,
  SUPPORTED_LOCALES
} from "./localeRegistry.js";

export function createI18n({
  locale = detectLocale(),
  fallbackLocale = FALLBACK_LOCALE,
  messages = MESSAGES
} = {}) {
  const normalizedLocale = normalizeLocale(locale, messages);
  const normalizedFallback = normalizeLocale(fallbackLocale, messages) || DEFAULT_LOCALE;
  const missingKeys = new Set();

  return {
    locale: normalizedLocale || normalizedFallback,
    fallbackLocale: normalizedFallback,
    messages,
    missingKeys,
    t(key, params = {}, fallback = key) {
      const value = getMessageValue(messages[this.locale], key)
        ?? getMessageValue(messages[this.fallbackLocale], key);

      if (typeof value !== "string") {
        missingKeys.add(key);
        return interpolate(String(fallback ?? key), params);
      }

      return interpolate(value, params);
    },
    setLocale(nextLocale) {
      const resolved = normalizeLocale(nextLocale, messages);
      if (!resolved) return false;
      this.locale = resolved;
      persistLocale(resolved);
      return true;
    },
    resolveDefinitionText(definition, field = "name", fallback = "") {
      if (!definition) return fallback;

      const key = getDefinitionTextKey(definition, field);
      const legacyFallback = getDefinitionFallback(definition, field, this.locale, fallback);
      return key ? this.t(key, {}, legacyFallback) : legacyFallback;
    },
    formatNumber(value, options = {}) {
      return new Intl.NumberFormat(this.locale, options).format(value);
    },
    formatDateTime(value, options = {}) {
      return new Intl.DateTimeFormat(this.locale, options).format(value);
    }
  };
}

export function detectLocale() {
  const stored = readStoredLocale();
  if (stored) return stored;

  const language = typeof navigator !== "undefined" ? navigator.language : "";
  if (!language) return DEFAULT_LOCALE;
  return language.split("-")[0];
}

export function normalizeLocale(locale, messages = MESSAGES) {
  if (!locale) return null;
  const normalized = String(locale).toLowerCase().split("-")[0];
  return Object.prototype.hasOwnProperty.call(messages, normalized) ? normalized : null;
}

export function getDefinitionTextKey(definition, field = "name") {
  if (field === "name") return definition.label_key || null;
  return definition[`${field}_key`] || null;
}

export function validateI18nCatalog({
  messages = MESSAGES,
  fallbackLocale = FALLBACK_LOCALE
} = {}) {
  const errors = [];
  const fallbackMessages = messages[fallbackLocale] || {};

  Object.keys(messages).forEach((locale) => {
    const missing = findMissingKeys(fallbackMessages, messages[locale]);
    missing.forEach((key) => errors.push(`${locale} is missing ${key}`));
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateDefinitionI18nKeys(definitionGroups, {
  messages = MESSAGES,
  locales = Object.keys(messages)
} = {}) {
  const errors = [];
  const definitions = Object.entries(definitionGroups || {}).flatMap(([groupName, group]) => {
    const values = Array.isArray(group) ? group : Object.values(group || {});
    return values.map((definition) => ({ groupName, definition }));
  });

  definitions.forEach(({ groupName, definition }) => {
    Object.keys(definition || {}).filter((field) => field.endsWith("_key")).forEach((field) => {
      const key = definition?.[field];
      if (!key) return;

      locales.forEach((locale) => {
        if (typeof getMessageValue(messages[locale], key) !== "string") {
          errors.push(`${groupName}:${definitionKey(definition)} ${field} missing ${locale}.${key}`);
        }
      });
    });
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

function getDefinitionFallback(definition, field, locale, fallback) {
  if (field === "name") {
    if (locale === "en" && definition.name_en) return definition.name_en;
    return definition.name || definition.name_en || fallback;
  }

  return definition[field] || fallback;
}

function getMessageValue(source, key) {
  if (!source || !key) return null;
  return String(key).split(".").reduce((value, part) => {
    if (value == null || typeof value !== "object") return null;
    return Object.prototype.hasOwnProperty.call(value, part) ? value[part] : null;
  }, source);
}

function definitionKey(definition) {
  return definition?.item_id
    || definition?.resource_id
    || definition?.building_id
    || definition?.sector_id
    || "unknown";
}

function interpolate(template, params) {
  return String(template).replace(/\{([^}]+)\}/g, (match, key) => {
    const value = params[key.trim()];
    return value == null ? match : String(value);
  });
}

function findMissingKeys(reference, target, prefix = "") {
  const missing = [];

  Object.entries(reference || {}).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const targetValue = target?.[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      missing.push(...findMissingKeys(value, targetValue, path));
      return;
    }

    if (typeof targetValue !== "string") missing.push(path);
  });

  return missing;
}

function readStoredLocale() {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(LOCALE_STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

function persistLocale(locale) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Locale persistence is a convenience, not a critical path.
  }
}

export {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  LOCALE_STORAGE_KEY,
  MESSAGES,
  SUPPORTED_LOCALES
};
