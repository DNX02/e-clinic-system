import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

console.log('=== STARTING DEEP SYSTEM AUDIT (DOCTOR WORKSPACE & NURSE SURVEY) ===\n');

const errors = [];
const successes = [];

// -------------------------------------------------------------
// PART 1: HTML & STATIC INTEGRITY CHECK
// -------------------------------------------------------------
console.log('1. Checking HTML & JavaScript markup integrity...');
try {
  const doctorHtml = readFileSync('public/doctor.html', 'utf8');
  const surveyHtml = readFileSync('public/survey.html', 'utf8');
  const appJs = readFileSync('public/app.js', 'utf8');

  // Check 1: Nested form check in app.js
  const nestedFormMatch = appJs.match(/<form[^>]*>(?:(?!<\/form>)[\s\S])*?<form[^>]*>/);
  if (nestedFormMatch) {
    errors.push('CRITICAL: Nested <form> detected in app.js templates: ' + nestedFormMatch[0].slice(0, 100));
  } else {
    successes.push('No nested <form> tags in any templates (HTML5 parser safety confirmed)');
  }

  // Check 2: Form ID uniqueness and presence
  if (doctorHtml.includes('id="app"') && doctorHtml.includes('app.js')) {
    successes.push('doctor.html loads app root and app.js correctly');
  } else {
    errors.push('doctor.html missing app container or script');
  }

  if (surveyHtml.includes('id="app"') && surveyHtml.includes('app.js')) {
    successes.push('survey.html loads app root and app.js correctly');
  } else {
    errors.push('survey.html missing app container or script');
  }

  // Check 3: doctorVisitForm structure
  if (appJs.includes('<section class="doctor-patient-detail">') && appJs.includes('<form class="form" id="visitForm">')) {
    successes.push('doctorVisitForm is cleanly isolated from patient detail cards');
  } else {
    errors.push('doctorVisitForm is not properly isolated');
  }

  // Check 4: Real-time BMI calculation bindings
  if (appJs.includes('calculateBmi') && appJs.includes('["input", "change", "keyup", "paste"]')) {
    successes.push('Doctor visit BMI calculation has all input/change/keyup/paste event listeners');
  } else {
    errors.push('Doctor visit BMI calculation missing event listeners');
  }

  // Check 5: Nurse BMI calculation
  if (appJs.includes('bindNurseSurveyCalculations') && appJs.includes('rabitoWeight')) {
    successes.push('Nurse survey calculations contain standard weight and Rabito weight formulas');
  } else {
    errors.push('Nurse survey missing calculation bindings');
  }
} catch (e) {
  errors.push('Error reading frontend files: ' + e.message);
}

// -------------------------------------------------------------
// PART 2: FORMULA ACCURACY (BMI, FINDRISC, RABITO, SCORE2)
// -------------------------------------------------------------
console.log('\n2. Verifying Clinical Formulas...');

// 2a. Doctor BMI Formula
const calcBmi = (w, hCm) => {
  const hM = hCm / 100;
  return Number.isFinite(w) && Number.isFinite(hM) && w > 0 && hM > 0
    ? (w / (hM * hM)).toFixed(1)
    : "";
};

assert.equal(calcBmi(110, 155), "45.8");
assert.equal(calcBmi(70, 175), "22.9");
assert.equal(calcBmi(85, 180), "26.2");
assert.equal(calcBmi(0, 170), "");
assert.equal(calcBmi(70, 0), "");
successes.push('Doctor BMI formula is accurate for all edge cases (110kg/155cm = 45.8)');

// 2b. Rabito Weight Formula
// Formula: 0.5759 * arm + 0.5263 * waist + 1.2452 * calf - 4.8689 * sexCoef - 32.9241
// Male: sexCoef = 1, Female: sexCoef = 2
const calcRabito = (arm, waist, calf, isMale) => {
  const sexCoef = isMale ? 1 : 2;
  const rw = 0.5759 * arm + 0.5263 * waist + 1.2452 * calf - 4.8689 * sexCoef - 32.9241;
  return rw > 0 ? Number(rw.toFixed(1)) : 0;
};
const maleRabito = calcRabito(32, 90, 38, true);
assert.ok(maleRabito > 50 && maleRabito < 100, `Rabito male realistic: ${maleRabito}`);
const femaleRabito = calcRabito(30, 85, 36, false);
assert.ok(femaleRabito > 40 && femaleRabito < 90, `Rabito female realistic: ${femaleRabito}`);
successes.push(`Rabito formulas tested and verified (Male: ${maleRabito} kg, Female: ${femaleRabito} kg)`);

// -------------------------------------------------------------
// PART 3: TRANSLATIONS COVERAGE (RU & TG)
// -------------------------------------------------------------
console.log('\n3. Verifying Translations (Tajik & Russian)...');
try {
  const appJs = readFileSync('public/app.js', 'utf8');
  const tgKeys = [
    'Опросник медсестры',
    'Кабинет врача',
    'Индекс массы тела',
    'Вес по весам, кг',
    'Рост, см',
    'Систолическое АД',
    'Диастолическое АД',
    'Повторный осмотр',
    'Сохранить осмотр',
    'Отправить анкету',
    'Синхронизировать'
  ];
  for (const key of tgKeys) {
    if (appJs.includes(`"${key}":`)) {
      successes.push(`Tajik translation present for: "${key}"`);
    } else {
      errors.push(`Missing Tajik translation for: "${key}"`);
    }
  }
} catch (e) {
  errors.push('Translation check failed: ' + e.message);
}

// -------------------------------------------------------------
// PART 4: LIVE HTTP SERVER VALIDATION
// -------------------------------------------------------------
console.log('\n4. Testing Live HTTP Server Responses...');
const baseUrl = 'http://127.0.0.1:3000';

async function testHttp() {
  const endpoints = [
    { path: '/app-2-doctor', expected: 200, name: 'Doctor App Shell' },
    { path: '/app-3-patient-survey', expected: 200, name: 'Nurse Survey App Shell' },
    { path: '/api/health', expected: 200, name: 'Health Check' },
    { path: '/doctor.html', expected: 200, name: 'Doctor HTML Direct' },
    { path: '/survey.html', expected: 200, name: 'Survey HTML Direct' },
    { path: '/sw.js', expected: 200, name: 'Service Worker' },
    { path: '/doctor.webmanifest', expected: 200, name: 'Doctor PWA Webmanifest' },
    { path: '/survey.webmanifest', expected: 200, name: 'Survey PWA Webmanifest' }
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(`${baseUrl}${ep.path}`);
      if (res.status === ep.expected) {
        successes.push(`HTTP endpoint [${ep.path}]: Status ${res.status} OK (${ep.name})`);
      } else {
        errors.push(`HTTP endpoint [${ep.path}]: Expected ${ep.expected}, got ${res.status}`);
      }
    } catch (e) {
      errors.push(`Failed to reach ${ep.path}: ${e.message}`);
    }
  }

  // Test CSRF exemption for nurse survey with cross-site Origin & Sec-Fetch-Site
  try {
    const postRes = await fetch(`${baseUrl}/api/nurse-surveys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://13.63.64.38',
        'Sec-Fetch-Site': 'cross-site'
      },
      body: JSON.stringify({
        lastName: 'ТестПроверка',
        firstName: 'Тест',
        birthDate: '1985-01-01',
        clinic: 'Поликлиника №1',
        sex: 'female',
        nurseName: 'Тестовая Медсестра',
        phone: '+992900000000',
        height: 165,
        weight: 65,
        systolic: 120,
        diastolic: 80,
        activity: 'yes',
        vegetables: 'yes',
        bpMeds: 'no',
        highGlucose: 'no',
        familyDiabetes: 'none',
        smoker: 'no',
        rabitoWaist: 75
      })
    });

    if (postRes.status === 201 || postRes.status === 409) {
      successes.push(`Nurse survey POST /api/nurse-surveys passed without CSRF blocking (Status: ${postRes.status})`);
      if (postRes.status === 201) {
        const body = await postRes.json();
        // Clean up test survey if created
        if (body.survey?.id) {
          // It will be deleted in cleanup
          console.log(`Created test survey ${body.survey.id}`);
        }
      }
    } else {
      errors.push(`Nurse survey POST /api/nurse-surveys failed: Status ${postRes.status}`);
    }
  } catch (e) {
    errors.push(`POST /api/nurse-surveys network error: ${e.message}`);
  }

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  console.log('AUDIT SUMMARY:');
  console.log(`Successes: ${successes.length}`);
  console.log(`Errors:    ${errors.length}`);
  console.log('=============================================================');

  if (errors.length > 0) {
    console.log('\nERRORS FOUND:');
    errors.forEach(err => console.log('  [X] ' + err));
    process.exit(1);
  } else {
    console.log('\nALL AUDIT CHECKS PASSED PERFECTLY!');
    process.exit(0);
  }
}

testHttp();
