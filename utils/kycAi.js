const { normalizeDateForComparison, normalizeDateToIsoCandidates } = require('./dateUtils');

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9@._\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeDateText(value) {
  return normalizeDateForComparison(value);
}

function extractDateCandidatesFromText(text) {
  const source = String(text || '');
  if (!source.trim()) {
    return [];
  }

  const patterns = [
    /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g,
    /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g
  ];

  const candidates = [];
  const seen = new Set();
  const lowerSource = source.toLowerCase();

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const raw = String(match[0] || '').trim();
      const normalizedCandidates = normalizeDateToIsoCandidates(raw);
      if (!raw || !normalizedCandidates.length) {
        continue;
      }

      const start = Math.max(0, match.index - 40);
      const end = Math.min(source.length, match.index + raw.length + 40);
      const context = lowerSource.slice(start, end);
      let labelScore = 0;
      if (/(date of birth|dob|birth|born|naissance|birthday)/.test(context)) {
        labelScore += 5;
      }
      if (/(id|passport|document|expiry|issue|issued|valid|expiration)/.test(context)) {
        labelScore += 1;
      }

      normalizedCandidates.forEach((normalized, variantIndex) => {
        const dedupeKey = `${raw}|${normalized}|${match.index}`;
        if (seen.has(dedupeKey)) {
          return;
        }
        seen.add(dedupeKey);

        candidates.push({
          raw,
          normalized,
          index: match.index,
          labelScore,
          variantIndex,
          ambiguous: normalizedCandidates.length > 1
        });
      });
    }
  }

  return candidates.sort((left, right) => {
    if (right.labelScore !== left.labelScore) {
      return right.labelScore - left.labelScore;
    }
    return left.index - right.index;
  });
}

function chooseDobCandidateFromText(text, userDob = null) {
  const detectedDates = extractDateCandidatesFromText(text);
  const userDobIso = normalizeDateText(userDob);

  if (!detectedDates.length) {
    return {
      selectedDob: null,
      selectedDobReason: 'No valid date could be identified on the document.',
      detectedDates
    };
  }

  let selectedCandidate = detectedDates[0];
  let selectedScore = selectedCandidate.labelScore;

  const exactMatches = userDobIso
    ? detectedDates.filter((candidate) => candidate.normalized === userDobIso)
    : [];

  if (exactMatches.length) {
    selectedCandidate = exactMatches.sort((left, right) => {
      if (right.labelScore !== left.labelScore) {
        return right.labelScore - left.labelScore;
      }
      return left.index - right.index;
    })[0];
    selectedScore = selectedCandidate.labelScore + 100;
  } else {
    for (const candidate of detectedDates) {
      let score = candidate.labelScore;
      if (userDobIso && candidate.normalized === userDobIso) {
        score += 10;
      }
      if (score > selectedScore) {
        selectedCandidate = candidate;
        selectedScore = score;
      }
    }
  }

  const matchedUserDob = !!(userDobIso && selectedCandidate.normalized === userDobIso);
  const selectedDobReason = matchedUserDob
    ? (selectedCandidate.ambiguous
      ? 'An ambiguous OCR date was resolved against the account date of birth.'
      : 'Matched the date of birth stored in the account.')
    : (selectedCandidate.labelScore > 0
      ? 'The OCR text near the birth label was selected.'
      : 'The first valid date found in the OCR text was selected.');

  return {
    selectedDob: selectedCandidate.normalized,
    selectedDobReason,
    detectedDates
  };
}

function sameText(a, b) {
  return normalizeText(a) === normalizeText(b);
}

function containsText(source, needle) {
  const normalizedSource = normalizeText(source);
  const normalizedNeedle = normalizeText(needle);
  return normalizedSource.length > 0 && normalizedNeedle.length > 0 && normalizedSource.includes(normalizedNeedle);
}

function isValidIdentityDocument(file) {
  if (!file) {
    return { valid: false, reason: 'A document is required.' };
  }

  const mime = String(file.mimetype || file.mimeType || '').toLowerCase();
  const allowed = mime.startsWith('image/');
  if (!allowed) {
    return { valid: false, reason: 'Only image documents are accepted for event KYC.' };
  }

  const maxSize = 25 * 1024 * 1024;
  const size = Number(file.size || 0);
  if (!Number.isFinite(size) || size <= 0 || size > maxSize) {
    return { valid: false, reason: 'The document exceeds the allowed size.' };
  }

  return { valid: true, reason: null };
}

function scoreFromFaceDistance(distance) {
  if (!Number.isFinite(Number(distance))) {
    return null;
  }

  const numericDistance = Number(distance);
  if (numericDistance < 0) {
    return null;
  }

  const normalized = Math.max(0, Math.min(1, 1 - numericDistance / 0.6));
  return Math.round(normalized * 100);
}

function evaluateEventKycSubmission(user, submission = {}, file = null, analysis = {}) {
  const reasons = [];
  let score = 0;
  const ocrText = String(analysis.ocrText || '');
  const ocrSelection = chooseDobCandidateFromText(ocrText, user?.dob);

  const documentCheck = isValidIdentityDocument(file);
  if (!documentCheck.valid) {
    reasons.push(documentCheck.reason);
  } else {
    score += 20;
  }

  const fullName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
  const submittedFullName = String(submission.full_name || '').trim();
  if (sameText(submittedFullName, fullName)) {
    score += 20;
  } else if (containsText(submittedFullName, user?.first_name) && containsText(submittedFullName, user?.last_name)) {
    score += 12;
  } else {
    reasons.push('The full name does not match the account record.');
  }

  const submittedDob = String(submission.dob || '').trim();
  if (submittedDob && user?.dob) {
    const userDobText = normalizeDateText(user.dob);
    const submittedDobText = normalizeDateText(submittedDob);
    if (userDobText && submittedDobText && userDobText === submittedDobText) {
      score += 10;
    } else {
      reasons.push('The date of birth does not match the account record.');
    }
  }

  const normalizedOcrText = normalizeText(ocrText);
  if (!normalizedOcrText) {
    reasons.push('The identity document text could not be read.');
  } else {
    const nameMatches = containsText(normalizedOcrText, user?.first_name) && containsText(normalizedOcrText, user?.last_name);
    if (nameMatches) {
      score += 15;
    } else {
      reasons.push('The document name does not match the account record.');
    }

    if (user?.dob) {
      const dobDigits = normalizeDateText(user.dob);
      if (dobDigits && ocrSelection.selectedDob && dobDigits === normalizeDateText(ocrSelection.selectedDob)) {
        score += 10;
      } else {
        reasons.push('The document date of birth does not match the account record.');
      }
    }
  }

  const faceMatchDistance = Number(analysis.faceMatchDistance);
  const faceScore = scoreFromFaceDistance(faceMatchDistance);
  if (faceScore === null) {
    reasons.push('The face comparison could not be completed.');
  } else if (faceMatchDistance <= 0.45) {
    score += 20;
  } else if (faceMatchDistance <= 0.6) {
    score += 8;
  } else {
    reasons.push('The selfie does not match the document face.');
  }

  const approved = reasons.length === 0 && score >= 80;

  return {
    approved,
    score: Math.max(0, Math.min(100, score)),
    reasons,
    summary: approved
      ? 'The verification passed. The account data, OCR text, and face comparison all matched.'
      : 'The verification failed. The request does not meet the automated checks.',
    documentValid: documentCheck.valid,
    documentReason: documentCheck.reason,
    faceMatchScore: faceScore,
    matchedFullName: sameText(submittedFullName, fullName),
    matchedDob: !!(submittedDob && user?.dob && normalizeDateText(user.dob) === normalizeDateText(submittedDob)),
    ocrTextExcerpt: ocrText.trim().slice(0, 500),
    ocrDetectedDates: ocrSelection.detectedDates,
    ocrSelectedDob: ocrSelection.selectedDob,
    ocrSelectedDobReason: ocrSelection.selectedDobReason,
    aiProvider: 'open-source',
    aiModel: 'tesseract.js + face-api.js'
  };
}

module.exports = {
  evaluateEventKycSubmission,
  normalizeText,
  sameText,
  containsText,
  isValidIdentityDocument,
  scoreFromFaceDistance,
  extractDateCandidatesFromText,
  chooseDobCandidateFromText
};
