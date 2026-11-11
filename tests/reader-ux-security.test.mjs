import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isMobileReaderPath, MOBILE_READER_ROUTE } from '../src/lib/distribution.ts';

const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('reader is an explicit independent URL and web purchase views stay separate', () => {
  assert.equal(MOBILE_READER_ROUTE, '/reader');
  assert.equal(isMobileReaderPath('/reader'), true);
  assert.equal(isMobileReaderPath('/reader/'), true);
  assert.equal(isMobileReaderPath('/'), false);
  assert.equal(isMobileReaderPath('/reader/pay'), false);
  assert.equal(isMobileReaderPath('/checkout'), false);
  const rewrites = JSON.parse(source('vercel.json')).rewrites;
  assert.ok(rewrites.some(entry => entry.source === '/reader' && entry.destination === '/index.html'));
});

test('reader hides purchase and deposit UI across all user paths', () => {
  const app = source('src/App.tsx');
  const navbar = source('src/components/Navbar.tsx');
  const watch = source('src/components/WatchPlayer.tsx');
  const bundle = source('src/pages/BundlesPage.tsx');
  const dashboard = source('src/pages/UserDashboardPage.tsx');
  const directory = source('src/pages/CreatorsDirectoryPage.tsx');
  assert.match(app, /!readerMode && <WalletDepositModal/);
  assert.match(app, /!readerMode && <CreatorApplicationModal/);
  assert.match(navbar, /!readerMode && <button onClick=\{\(\) => openDepositModal\(\)\}/);
  assert.match(navbar, /readerMode \? 'grid-cols-4' : 'grid-cols-5'/);
  assert.match(watch, /if \(readerMode\) return;/);
  assert.match(watch, /!readerMode && <div className="space-y-2\.5"/);
  assert.match(bundle, /if \(readerMode\) return;/);
  assert.match(bundle, /\) : readerMode \? \(/);
  assert.match(dashboard, /!readerMode && activeTab === 'wallet'/);
  assert.match(directory, /!readerMode && <button/);
});

test('account deletion is discoverable and never tells users their funds disappear', () => {
  const dashboard = source('src/pages/UserDashboardPage.tsx');
  const page = source('public/account-deletion.html');
  assert.match(dashboard, /Type DELETE/);
  assert.match(dashboard, /positive wallet balance/);
  assert.match(page, /cannot proceed while a positive wallet balance/);
  assert.doesNotMatch(page, /wallet balance will be lost/);
  assert.match(source('server.ts'), /settle or refund your remaining wallet balance/);
  assert.match(dashboard, /requestedTab === 'profile'/);
});

test('mobile readability keeps pinch zoom, focus and motion accessibility', () => {
  assert.doesNotMatch(source('index.html'), /user-scalable=no|maximum-scale=1/);
  assert.match(source('src/index.css'), /prefers-reduced-motion: reduce/);
  assert.match(source('src/index.css'), /:focus-visible/);
  assert.match(source('src/App.tsx'), /Skip to main content/);
});
