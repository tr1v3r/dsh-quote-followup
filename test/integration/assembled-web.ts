// Copyright (c) 2026 foo-hao. SPDX-License-Identifier: MIT
// Fixture construction follows DeepSeek Harness Web tests, Copyright (c) 2026 DeepSeek.
// The accompanying integration LICENSE preserves both notices.
// The runner places this scenario beneath DSH's Web test directory so it uses
// that checkout's real composition, module resolver and test dependencies.
import { join } from 'node:path'
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import { launchWebScaffold, seedSession, type WebScaffold } from '../scaffold.ts'

const EXCERPT = 'A quote should preserve the existing draft.'
const OTHER = 'A second excerpt remains independent.'
const pluginRoot = process.env.DSH_QUOTE_PLUGIN_ROOT
if (!pluginRoot) throw new Error('Use the assembled-Web test runner.')

function fixture(title: string): string {
  const session = Session.create(SessionId('quote-fixture-source'))
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Explain these two checks.' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', { title, messageSeqs: [user.seq], source: { kind: 'fallback' } })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    stream: [], turn: 1, step: 1,
    message: createMessage({ role: 'assistant', content: [{ type: 'text', text: `${EXCERPT}\n\n${OTHER}` }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' } }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return [JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
    createdAt: 0, cwd: '{{cwd}}', isSeeded: false, delegationDepth: 0 }),
  ...session.snapshotEvents().map(event => JSON.stringify({ ...event, time: event.seq * 1000 })), ''].join('\n')
}

describe('quote-followup in assembled DSH Web', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: process.env.DSH_QUOTE_OVERLAY,
      extraInstallAnchors: [join(pluginRoot, 'package.json')],
    })
    await seedSession(scaffold, fixture('Quote Alpha'), 'quote-alpha', undefined, { createdAt: Date.now() - 10000 })
    await seedSession(scaffold, fixture('Quote Beta'), 'quote-beta', undefined, { createdAt: Date.now() - 20000 })
    browser = await chromium.launch()
  })
  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })
  beforeEach(async () => {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]')
    await page.locator('[role="treeitem"]').first().click()
    await expect.poll(() => page.locator('[role="treeitem"]').count()).toBe(3)
    await page.locator('[role="treeitem"]').nth(1).click()
    await page.getByRole('button', { name: 'Quote Alpha', exact: true }).waitFor()
    await page.getByText(EXCERPT, { exact: true }).waitFor()
  })
  afterEach(async () => { await page?.close() })

  const input = () => page.locator('[data-composer-input]')
  async function quote(text: string): Promise<void> {
    await page.getByText(text, { exact: true }).evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await page.locator('#dsh-quote-followup-btn').click()
  }

  it('keeps the existing draft and inserts repeated native quote chips', async () => {
    await input().fill('Keep my question. ')
    await quote(EXCERPT)
    await expect.poll(() => input().textContent()).toContain('Keep my question.')
    await expect.poll(() => input().locator('[title]').count()).toBe(1)
    await quote(OTHER)
    await expect.poll(() => input().locator('[title]').count()).toBe(2)
    expect(await input().textContent()).toContain(EXCERPT)
    expect(await input().textContent()).toContain(OTHER)
    const beforeUndo = await input().textContent()
    await input().press('ControlOrMeta+z')
    await expect.poll(() => input().textContent()).not.toBe(beforeUndo)
    await input().press('ControlOrMeta+Shift+z')
    await expect.poll(() => input().textContent()).toBe(beforeUndo)
  })

  it('keeps quoted drafts scoped to their session', async () => {
    await input().fill('Alpha draft. ')
    await quote(EXCERPT)
    await page.locator('[role="treeitem"][aria-selected="false"]').click()
    await expect.poll(() => input().textContent()).toBe('')
    await input().fill('Beta draft. ')
    await quote(OTHER)
    await page.getByRole('treeitem').filter({ hasText: 'Quote Alpha' }).click()
    await expect.poll(() => input().textContent()).toContain('Alpha draft.')
    expect(await input().textContent()).not.toContain('Beta draft.')
    expect(await input().textContent()).not.toContain(OTHER)
  })

  it('expands the quote through the real client prompt serialization boundary', async () => {
    await input().fill('Explain this: ')
    await quote(EXCERPT)
    const request = Promise.withResolvers<unknown>()
    await page.route('**/api/session/prompt', async route => {
      request.resolve(route.request().postDataJSON())
      await route.abort('blockedbyclient')
    })
    await input().press('Enter')
    const serialized = JSON.stringify(await request.promise)
    expect(serialized).toContain('Explain this:')
    expect(serialized).toContain(`> ${EXCERPT}`)
    expect(serialized).toContain('quote-alpha')
    expect(serialized).not.toContain('reference-chip')
  })
  it('leaves the draft intact when the Host makes the composer unavailable', async () => {
    await input().fill('Preserve this locked draft.')
    const previous = scaffold.ctx.agentDefaultModel.currentSelection()
    try {
      await scaffold.ctx.settings.replace('agent-default-model', { provider: 'unavailable-fixture', model: 'missing' })
      await expect.poll(() => input().getAttribute('contenteditable')).toBe('false')
      const before = await input().textContent()
      await quote(EXCERPT)
      expect(await input().textContent()).toBe(before)
      expect(await input().locator('[title]').count()).toBe(0)
    } finally {
      await scaffold.ctx.agentDefaultModel.saveSelection(previous)
    }
  })

})
