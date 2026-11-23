import test from 'node:test';
import assert from 'node:assert/strict';
import { parseValidatedDataImage, validateAppImageUrl } from './mediaValidation';

test('validateAppImageUrl accepts internal media API URLs, asset paths, HTTPS, and safe data URLs', () => {
  assert.equal(validateAppImageUrl('/api/media/med_1234abcd5678'), '/api/media/med_1234abcd5678');
  assert.equal(
    validateAppImageUrl('/src/assets/images/dish_truffle_pizza_1795406026216.jpg'),
    '/src/assets/images/dish_truffle_pizza_1795406026216.jpg'
  );
  assert.equal(
    validateAppImageUrl('https://xyz.supabase.co/storage/v1/object/public/restaurant-media/staff/a.png'),
    'https://xyz.supabase.co/storage/v1/object/public/restaurant-media/staff/a.png'
  );
  assert.equal(validateAppImageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
});

test('validateAppImageUrl rejects unsafe protocols, traversal, and oversized URLs', () => {
  assert.equal(validateAppImageUrl('javascript:alert(1)'), null);
  assert.equal(validateAppImageUrl('http://insecure.example.com/a.png'), null);
  assert.equal(validateAppImageUrl('/api/media/../../etc/passwd'), null);
  assert.equal(validateAppImageUrl(''), null);
});

test('parseValidatedDataImage accepts valid PNG and safe SVG, and blocks SVG XSS payloads', () => {
  const png = parseValidatedDataImage('data:image/png;base64,iVBORw0KGgo=');
  assert.deepEqual(png, { mimeType: 'image/png', base64Data: 'iVBORw0KGgo=' });

  const safeSvgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="5"/></svg>').toString('base64');
  const safeSvg = parseValidatedDataImage(`data:image/svg+xml;base64,${safeSvgBase64}`);
  assert.equal(safeSvg?.mimeType, 'image/svg+xml');

  const scriptSvgBase64 = Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64');
  assert.equal(parseValidatedDataImage(`data:image/svg+xml;base64,${scriptSvgBase64}`), null);

  const eventSvgBase64 = Buffer.from('<svg onload="alert(1)"></svg>').toString('base64');
  assert.equal(parseValidatedDataImage(`data:image/svg+xml;base64,${eventSvgBase64}`), null);

  const foreignObjBase64 = Buffer.from('<svg><foreignObject><div>hi</div></foreignObject></svg>').toString('base64');
  assert.equal(parseValidatedDataImage(`data:image/svg+xml;base64,${foreignObjBase64}`), null);
});
