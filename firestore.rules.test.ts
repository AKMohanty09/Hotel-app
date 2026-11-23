import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rules = fs.readFileSync('firestore.rules', 'utf8');
const blueprint = JSON.parse(fs.readFileSync('firebase-blueprint.json', 'utf8'));

test('firestore.rules enforces global deny safety net and rules_version 2', () => {
  assert.match(rules, /rules_version = '2';/);
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
});

test('firestore.rules covers every collection declared in firebase-blueprint.json', () => {
  const paths = Object.keys(blueprint.firestore || {});
  assert.ok(paths.length >= 12);
  for (const path of paths) {
    const collectionName = path.split('/')[1];
    assert.ok(
      rules.includes(`match /${collectionName}/`),
      `Missing match block for collection ${collectionName}`
    );
  }
});

test('firestore.rules restricts OTP storage and prevents open writes', () => {
  assert.equal(/allow\s+(read|write)\s*:\s*if\s+true/.test(rules), false);
  assert.match(rules, /email_verified == true/);
  assert.match(rules, /incoming\(\)\.qrToken == existing\(\)\.qrToken/);
  assert.match(rules, /existing\(\)\.presenceConfirmed == true/);
  assert.match(rules, /allow update, delete: if false;/);
});
