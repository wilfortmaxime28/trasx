const { normalizeDateForComparison, normalizeDateToIsoCandidates } = require('./dateUtils');
const sharp = require('sharp');
const faceapi = require('face-api.js');
const tf = faceapi.tf;
const path = require('path');

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

function levenshteinDistance(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,    // deletion
          dp[i][j - 1] + 1,    // insertion
          dp[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }
  return dp[m][n];
}

function fuzzyContains(ocrText, searchWord, maxDistanceFraction = 0.3) {
  const target = normalizeText(searchWord);
  if (!target) return true; // Empty search word is always "found"
  
  const ocrNormalized = normalizeText(ocrText);
  if (!ocrNormalized) return false;

  const searchWords = target.split(' ');
  const ocrWords = ocrNormalized.split(' ');

  for (const sWord of searchWords) {
    if (sWord.length <= 2) {
      if (!ocrWords.includes(sWord)) {
        return false;
      }
      continue;
    }
    
    let foundMatch = false;
    const maxDist = Math.floor(sWord.length * maxDistanceFraction);
    
    for (const oWord of ocrWords) {
      if (oWord.includes(sWord) || sWord.includes(oWord)) {
        foundMatch = true;
        break;
      }
      if (Math.abs(oWord.length - sWord.length) <= maxDist) {
        const dist = levenshteinDistance(sWord, oWord);
        if (dist <= maxDist) {
          foundMatch = true;
          break;
        }
      }
    }
    
    if (!foundMatch) {
      return false;
    }
  }
  
  return true;
}

const MONTH_WORDS = {
  1: ['01', '1', 'jan', 'janv', 'janvier', 'january'],
  2: ['02', '2', 'feb', 'fev', 'fevr', 'fevrier', 'february'],
  3: ['03', '3', 'mar', 'mars', 'march'],
  4: ['04', '4', 'apr', 'avr', 'avril', 'april'],
  5: ['05', '5', 'may', 'mai'],
  6: ['06', '6', 'jun', 'juin', 'june'],
  7: ['07', '7', 'jul', 'juil', 'juillet', 'july'],
  8: ['08', '8', 'aug', 'aout', 'august'],
  9: ['09', '9', 'sep', 'sept', 'septembre', 'september'],
  10: ['10', 'oct', 'octobre', 'october'],
  11: ['11', 'nov', 'novembre', 'november'],
  12: ['12', 'dec', 'dece', 'decembre', 'december']
};

function fuzzyMatchYear(ocrText, yearStr) {
  if (!yearStr || yearStr.length < 4) return false;
  const normalizedOcr = normalizeText(ocrText);
  
  const last2Digits = yearStr.slice(2);
  
  let patternStr = '\\b';
  for (const char of yearStr) {
    if (char === '1') patternStr += '[1lI|]';
    else if (char === '0') patternStr += '[0oO]';
    else if (char === '5') patternStr += '[5sS]';
    else if (char === '8') patternStr += '[8B]';
    else if (char === '6') patternStr += '[6G]';
    else if (char === '9') patternStr += '[9gG]';
    else patternStr += char;
  }
  patternStr += '\\b';
  
  const regex = new RegExp(patternStr);
  if (regex.test(normalizedOcr)) {
    return true;
  }
  
  let shortPattern = '\\b';
  for (const char of last2Digits) {
    if (char === '1') shortPattern += '[1lI|]';
    else if (char === '0') shortPattern += '[0oO]';
    else if (char === '5') shortPattern += '[5sS]';
    else if (char === '8') shortPattern += '[8B]';
    else if (char === '6') shortPattern += '[6G]';
    else if (char === '9') shortPattern += '[9gG]';
    else shortPattern += char;
  }
  shortPattern += '\\b';
  const shortRegex = new RegExp(shortPattern);
  return shortRegex.test(normalizedOcr);
}

function fuzzyMatchMonth(ocrText, monthNum) {
  const normalizedOcr = normalizeText(ocrText);
  const monthList = MONTH_WORDS[monthNum];
  if (!monthList) return false;
  
  for (const mWord of monthList) {
    if (mWord.match(/^\d+$/)) {
      let pattern = '\\b';
      for (const char of mWord) {
        if (char === '1') pattern += '[1lI|]';
        else if (char === '0') pattern += '[0oO]';
        else if (char === '5') pattern += '[5sS]';
        else if (char === '8') pattern += '[8B]';
        else if (char === '6') pattern += '[6G]';
        else if (char === '9') pattern += '[9gG]';
        else pattern += char;
      }
      pattern += '\\b';
      const regex = new RegExp(pattern);
      if (regex.test(normalizedOcr)) {
        return true;
      }
    } else {
      if (normalizedOcr.includes(mWord)) {
        return true;
      }
    }
  }
  return false;
}

function fuzzyMatchDay(ocrText, dayNum) {
  const normalizedOcr = normalizeText(ocrText);
  const dStr = String(dayNum);
  const dStrPadded = dStr.padStart(2, '0');
  
  const dayVariants = [dStr, dStrPadded];
  for (const variant of dayVariants) {
    let pattern = '\\b';
    for (const char of variant) {
      if (char === '1') pattern += '[1lI|]';
      else if (char === '0') pattern += '[0oO]';
      else if (char === '5') pattern += '[5sS]';
      else if (char === '8') pattern += '[8B]';
      else if (char === '6') pattern += '[6G]';
      else if (char === '9') pattern += '[9gG]';
      else pattern += char;
    }
    pattern += '\\b';
    const regex = new RegExp(pattern);
    if (regex.test(normalizedOcr)) {
      return true;
    }
  }
  return false;
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
  const formNameMatches = sameText(submittedFullName, fullName) || 
                         (containsText(submittedFullName, user?.first_name) && containsText(submittedFullName, user?.last_name));
  if (sameText(submittedFullName, fullName)) {
    score += 20;
  } else if (containsText(submittedFullName, user?.first_name) && containsText(submittedFullName, user?.last_name)) {
    score += 12;
  } else {
    reasons.push('Le nom saisi dans le formulaire ne correspond pas à votre compte.');
  }

  const submittedDob = String(submission.dob || '').trim();
  let formDobMatches = false;
  if (submittedDob && user?.dob) {
    const userDobText = normalizeDateText(user.dob);
    const submittedDobText = normalizeDateText(submittedDob);
    if (userDobText && submittedDobText && userDobText === submittedDobText) {
      score += 10;
      formDobMatches = true;
    } else {
      reasons.push('La date de naissance saisie dans le formulaire ne correspond pas à votre compte.');
    }
  }

  console.log('[KYC OCR Debug] Starting OCR analysis evaluation.');
  console.log(`[KYC OCR Debug] User account fields -> First Name: "${user?.first_name}", Last Name: "${user?.last_name}", DOB: "${user?.dob}"`);
  console.log(`[KYC OCR Debug] Extracted raw OCR text (first 1000 chars):\n-------------------\n${ocrText.slice(0, 1000)}\n-------------------`);

  let nameMatches = false;
  let dobMatches = false;

  const normalizedOcrText = normalizeText(ocrText);
  if (!normalizedOcrText) {
    console.log('[KYC OCR Debug] Rejecting: Extracted OCR text is completely empty or has no readable alphanumeric characters.');
    reasons.push('Impossible de lire le texte du document d\'identité.');
  } else {
    const firstNameMatches = fuzzyContains(ocrText, user?.first_name);
    const lastNameMatches = fuzzyContains(ocrText, user?.last_name);
    nameMatches = firstNameMatches && lastNameMatches;
    
    console.log(`[KYC OCR Debug] Name matching results:`);
    console.log(`  - First name "${user?.first_name}" matches: ${firstNameMatches}`);
    console.log(`  - Last name "${user?.last_name}" matches: ${lastNameMatches}`);
    console.log(`  - Combined name match: ${nameMatches}`);

    if (nameMatches) {
      score += 15;
    } else {
      reasons.push('Le nom sur le document ne correspond pas à celui de votre compte.');
    }

    let dobMatchMethod = 'none';

    if (user?.dob) {
      const dobDigits = normalizeDateText(user.dob);
      if (dobDigits && ocrSelection.selectedDob && dobDigits === normalizeDateText(ocrSelection.selectedDob)) {
        dobMatches = true;
        dobMatchMethod = 'exact';
      } else {
        const dateObj = new Date(user.dob);
        if (!isNaN(dateObj.getTime())) {
          const year = dateObj.getUTCFullYear();
          const month = dateObj.getUTCMonth() + 1;
          const day = dateObj.getUTCDate();
          
          const yearOk = fuzzyMatchYear(ocrText, String(year));
          const monthOk = fuzzyMatchMonth(ocrText, month);
          const dayOk = fuzzyMatchDay(ocrText, day);
          
          console.log(`[KYC OCR Debug] Date of Birth fuzzy component check for "${year}-${month}-${day}":`);
          console.log(`  - Year "${year}" (or short variant) found: ${yearOk}`);
          console.log(`  - Month "${month}" (digit or word) found: ${monthOk}`);
          console.log(`  - Day "${day}" found: ${dayOk}`);

          if (yearOk && monthOk && dayOk) {
            dobMatches = true;
            dobMatchMethod = 'fuzzy_components';
          }
        }
      }
    }

    console.log(`[KYC OCR Debug] DOB matching result: ${dobMatches} (Method: ${dobMatchMethod})`);

    if (dobMatches) {
      score += 10;
    } else {
      reasons.push('La date de naissance sur le document ne correspond pas à celle de votre compte.');
    }
  }

  const faceMatchDistance = Number(analysis.faceMatchDistance);
  const selfieFaceDetected = analysis.selfieFaceDetected !== false;
  const docFaceDetected = analysis.docFaceDetected !== false;

  if (!docFaceDetected) {
    reasons.push("Aucun visage n'a été détecté sur l'image de votre document d'identité.");
  }
  if (!selfieFaceDetected) {
    reasons.push("Aucun visage n'a été détecté sur votre photo selfie. Assurez-vous d'être dans un endroit bien éclairé.");
  }

  let faceScore = null;
  if (docFaceDetected && selfieFaceDetected) {
    faceScore = scoreFromFaceDistance(faceMatchDistance);
    if (faceScore === null) {
      reasons.push('La comparaison faciale n\'a pas pu être effectuée.');
    } else if (faceMatchDistance <= 0.45) {
      score += 20;
    } else if (faceMatchDistance <= 0.6) {
      score += 8;
    } else {
      reasons.push('Le selfie ne correspond pas à la photo du document.');
    }
  }

  const documentValid = documentCheck.valid;
  const formNameValid = formNameMatches;
  const formDobValid = formDobMatches;
  const ocrNameValid = nameMatches;
  const ocrDobValid = dobMatches;
  const faceValid = docFaceDetected && selfieFaceDetected && faceMatchDistance <= 0.45;

  const approved = documentValid && 
                   formNameValid && 
                   formDobValid && 
                   ocrNameValid && 
                   ocrDobValid && 
                   faceValid && 
                   reasons.length === 0 && 
                   score >= 80;

  return {
    approved,
    score: Math.max(0, Math.min(100, score)),
    reasons,
    summary: approved
      ? 'La vérification a réussi. Les données du compte, le texte OCR et la comparaison faciale correspondent.'
      : 'La vérification a échoué. Les critères de sécurité automatisés ne sont pas remplis.',
    documentValid: documentCheck.valid,
    documentReason: documentCheck.reason,
    faceMatchScore: faceScore,
    matchedFullName: formNameMatches,
    matchedDob: formDobMatches,
    ocrTextExcerpt: ocrText.trim().slice(0, 500),
    ocrDetectedDates: ocrSelection.detectedDates,
    ocrSelectedDob: ocrSelection.selectedDob,
    ocrSelectedDobReason: ocrSelection.selectedDobReason,
    aiProvider: 'open-source',
    aiModel: 'tesseract.js + face-api.js'
  };
}


let modelsLoaded = false;

async function ensureModelsLoaded() {
  if (modelsLoaded) return;
  const modelPath = path.join(__dirname, '../public/models/face-api');
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath),
    faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath),
    faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath)
  ]);
  modelsLoaded = true;
}

async function imageToTensorResized(filePath, maxSize = 600) {
  const { data, info } = await sharp(filePath)
    .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  const tensor = tf.tensor3d(new Uint8Array(data), [info.height, info.width, info.channels], 'int32');
  if (info.channels === 4) {
    const rgbTensor = tf.slice3d(tensor, [0, 0, 0], [info.height, info.width, 3]);
    tensor.dispose();
    return rgbTensor;
  }
  
  if (info.channels === 1) {
    const rgbTensor = tf.concat([tensor, tensor, tensor], 2);
    tensor.dispose();
    return rgbTensor;
  }
  
  return tensor;
}

async function compareFacesOnServer(selfiePath, docPath) {
  try {
    await ensureModelsLoaded();
    
    const [selfieTensor, docTensor] = await Promise.all([
      imageToTensorResized(selfiePath, 600),
      imageToTensorResized(docPath, 600)
    ]);
    
    const detectorOptions = new faceapi.TinyFaceDetectorOptions({
      inputSize: 416,
      scoreThreshold: 0.45
    });
    
    const [selfieDetection, docDetection] = await Promise.all([
      faceapi.detectSingleFace(selfieTensor, detectorOptions).withFaceLandmarks().withFaceDescriptor(),
      faceapi.detectSingleFace(docTensor, detectorOptions).withFaceLandmarks().withFaceDescriptor()
    ]);
    
    selfieTensor.dispose();
    docTensor.dispose();
    
    const selfieFaceDetected = !!selfieDetection;
    const docFaceDetected = !!docDetection;
    
    let distance = 1.0;
    if (selfieFaceDetected && docFaceDetected) {
      distance = faceapi.euclideanDistance(selfieDetection.descriptor, docDetection.descriptor);
    }
    
    console.log('[Face Comparison] Results:', {
      selfieFaceDetected,
      docFaceDetected,
      distance
    });
    
    return {
      distance,
      selfieFaceDetected,
      docFaceDetected
    };
  } catch (err) {
    console.error('[Face Comparison] Error comparing faces:', err);
    return {
      distance: 1.0,
      selfieFaceDetected: false,
      docFaceDetected: false
    };
  }
}

async function documentHasFace(docPath) {
  let docTensor;
  try {
    await ensureModelsLoaded();
    docTensor = await imageToTensorResized(docPath, 600);
    const detectorOptions = new faceapi.TinyFaceDetectorOptions({
      inputSize: 224,
      scoreThreshold: 0.35
    });
    const detection = await faceapi.detectSingleFace(docTensor, detectorOptions);
    return !!detection;
  } catch (err) {
    console.error('[documentHasFace] Error during quick face check:', err);
    return true;
  } finally {
    if (docTensor) docTensor.dispose();
  }
}

module.exports = {
  evaluateEventKycSubmission,
  normalizeText,
  sameText,
  containsText,
  isValidIdentityDocument,
  scoreFromFaceDistance,
  extractDateCandidatesFromText,
  chooseDobCandidateFromText,
  compareFacesOnServer,
  documentHasFace
};
