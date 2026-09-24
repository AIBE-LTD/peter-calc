import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helperSource = html.match(
  /function createPdfTimeoutSignal\(milliseconds, abortSignalType[^]*?^}/m,
)?.[0];

test('PDF requests still start when AbortSignal.timeout is unavailable', () => {
  assert.ok(helperSource, 'createPdfTimeoutSignal must be defined in index.html');

  const context = vm.createContext({});
  vm.runInContext(helperSource, context);

  assert.equal(context.createPdfTimeoutSignal(45_000, undefined), undefined);
  assert.equal(
    html.includes("signal:AbortSignal.timeout(45000)"),
    false,
    'the PDF fetch must not call AbortSignal.timeout directly',
  );
});

test('PDF requests keep their timeout in browsers that support it', () => {
  assert.ok(helperSource, 'createPdfTimeoutSignal must be defined in index.html');

  const context = vm.createContext({});
  vm.runInContext(helperSource, context);
  const expectedSignal = {};
  let receivedMilliseconds;
  const supportedAbortSignal = {
    timeout(milliseconds) {
      receivedMilliseconds = milliseconds;
      return expectedSignal;
    },
  };

  assert.equal(
    context.createPdfTimeoutSignal(45_000, supportedAbortSignal),
    expectedSignal,
  );
  assert.equal(receivedMilliseconds, 45_000);
});
