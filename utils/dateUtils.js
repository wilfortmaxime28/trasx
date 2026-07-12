function pad(value) {
  return String(value).padStart(2, '0');
}

function isValidDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}

function isoFromParts(year, month, day) {
  if (!isValidDateParts(year, month, day)) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

function isoFromDateObject(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  return isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function parseFlexibleDateParts(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate()
    };
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const isoMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    return isValidDateParts(year, month, day) ? { year, month, day } : null;
  }

  const compactIsoMatch = raw.match(/^(\d{8})$/);
  if (compactIsoMatch) {
    const digits = compactIsoMatch[1];
    const year = Number(digits.slice(0, 4));
    const month = Number(digits.slice(4, 6));
    const day = Number(digits.slice(6, 8));
    if (isValidDateParts(year, month, day)) {
      return { year, month, day };
    }
  }

  const slashMatch = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (slashMatch) {
    let first = Number(slashMatch[1]);
    let second = Number(slashMatch[2]);
    let year = Number(slashMatch[3]);
    if (String(slashMatch[3]).length === 2) {
      year += year >= 70 ? 1900 : 2000;
    }

    const firstLooksDay = first > 12;
    const secondLooksDay = second > 12;
    const dayFirst = firstLooksDay || (!secondLooksDay && first <= 12);
    const day = dayFirst ? first : second;
    const month = dayFirst ? second : first;
    if (isValidDateParts(year, month, day)) {
      return { year, month, day };
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      year: parsed.getUTCFullYear(),
      month: parsed.getUTCMonth() + 1,
      day: parsed.getUTCDate()
    };
  }

  return null;
}

function normalizeDateToIso(value) {
  const parts = parseFlexibleDateParts(value);
  return parts ? isoFromParts(parts.year, parts.month, parts.day) : null;
}

function normalizeDateToIsoCandidates(value) {
  const candidates = [];
  const seen = new Set();

  const addCandidate = (candidate) => {
    if (!candidate || seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    candidates.push(candidate);
  };

  if (!value) {
    return candidates;
  }

  if (value instanceof Date) {
    addCandidate(isoFromDateObject(value));
    return candidates;
  }

  const raw = String(value).trim();
  if (!raw) {
    return candidates;
  }

  const directIso = normalizeDateToIso(raw);
  if (directIso) {
    addCandidate(directIso);
  }

  const slashMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    let first = Number(slashMatch[1]);
    let second = Number(slashMatch[2]);
    let year = Number(slashMatch[3]);
    if (String(slashMatch[3]).length === 2) {
      year += year >= 70 ? 1900 : 2000;
    }

    const asDayMonth = isValidDateParts(year, second, first) ? isoFromParts(year, second, first) : null;
    const asMonthDay = isValidDateParts(year, first, second) ? isoFromParts(year, first, second) : null;

    addCandidate(asDayMonth);
    addCandidate(asMonthDay);
    return candidates;
  }

  const compactDigits = raw.replace(/[^0-9]/g, '');
  if (compactDigits.length === 8) {
    const year = Number(compactDigits.slice(0, 4));
    const month = Number(compactDigits.slice(4, 6));
    const day = Number(compactDigits.slice(6, 8));
    addCandidate(isoFromParts(year, month, day));
  }

  return candidates;
}

function normalizeDateForComparison(value) {
  const iso = normalizeDateToIso(value);
  if (iso) {
    return iso;
  }

  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  return raw.replace(/[^0-9]/g, '');
}

module.exports = {
  isoFromDateObject,
  normalizeDateToIso,
  normalizeDateToIsoCandidates,
  normalizeDateForComparison
};
