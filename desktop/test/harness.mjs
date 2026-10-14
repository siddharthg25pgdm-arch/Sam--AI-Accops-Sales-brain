// Test helper: launch the real app with playwright-core's Electron driver on a throwaway profile.
import { _electron } from 'playwright-core';
import electronPath from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHOTS = path.resolve(DESKTOP, '..', 'shots', 'live-desktop');
export const tempDir = tag => fs.mkdtempSync(path.join(os.tmpdir(), `samlive-${tag}-`));
export const visible = name => `main > section[data-screen="${name}"]:not([hidden])`;

export async function launch({ profile, args = [] }) {
  const env = { ...process.env, SAM_LIVE_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE; // some hosts (VS Code) set it, which turns electron.exe into plain node
  const exe = process.env.SAM_LIVE_EXE; // e.g. dist/win-unpacked/SAM Live.exe to test the packaged build
  const app = await _electron.launch({ executablePath: exe || electronPath, args: exe ? args : [...args, DESKTOP], cwd: DESKTOP, env });
  const page = await app.firstWindow();
  page.on('pageerror', e => console.error('[renderer error]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[renderer console]', m.text()); });
  return { app, page };
}

export async function pointAt(page, serverUrl) {
  await page.click('#btn-settings');
  await page.fill('#server', serverUrl);
  await page.click('#server-save');
  await page.waitForFunction(() => document.getElementById('server-save').textContent === 'Saved');
  await page.click('#settings-done');
}

export async function signIn(page, id = 'siddharth', password = 'pw') {
  await page.fill('#signin-id', id);
  await page.fill('#signin-pw', password);
  await page.click('#signin-btn');
}

export async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(350); // let entry animations settle
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}
