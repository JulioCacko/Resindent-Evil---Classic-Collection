import { expect, test } from '@playwright/test'
import { closeApp, ensureMenu, launchApp, setDesignWindow } from './electron-app'

test('settings, secure credentials and key capture have one modal and persist', async ({}, testInfo) => {
  const handle = await launchApp()
  const { app, page } = handle
  try {
    await setDesignWindow(app, page)
    await ensureMenu(page)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-name="launch-panel"]')).toHaveCount(1)
    await page.keyboard.press('F1')
    await page.getByRole('button', { name: 'Accounts', exact: true }).click()
    await page.locator('[data-name="setting-retroAccount"]').click()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(page.locator('[data-figma-node="credentials-key"]')).toHaveAttribute('type', 'password')
    await page.locator('[data-figma-node="credentials-user"]').fill('test-user')
    await page.locator('[data-figma-node="credentials-key"]').fill('local-test-key-not-a-real-credential')
    await page.locator('[data-figma-node="credentials-save"]').click()
    await expect(page.locator('[data-figma-node="settings"]')).toBeVisible()
    const config = await page.evaluate(async () => (await window.reLauncher!.invoke('catalog:get', undefined)).config)
    expect(config.raConfigured).toBe(true)
    expect(JSON.stringify(config)).not.toContain('local-test-key')
    expect(config).not.toHaveProperty('raKey')
    await page.getByRole('button', { name: 'Controls', exact: true }).click()
    await page.locator('[data-name="setting-controls"]').click()
    const dialog = page.getByRole('dialog', { name: 'Launcher controls' })
    await expect(dialog).toBeVisible()
    await dialog.locator('.binding-row').filter({ hasText: 'Confirm' }).getByRole('button').first().click()
    await page.keyboard.press('KeyQ')
    await expect(dialog.locator('.binding-row').filter({ hasText: 'Confirm' }).getByRole('button').first()).toHaveText('Q')
    await page.screenshot({ path: testInfo.outputPath('launcher-controls-1920.png') })
    await dialog.getByRole('button', { name: 'RESTORE DEFAULTS' }).click()
    await dialog.getByRole('button', { name: 'BACK', exact: true }).click()
    await page.getByRole('button', { name: 'Presentation', exact: true }).click()
    await expect(page.locator('[data-name="setting-ingameCrt"]')).toHaveCount(0)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720))
    await page.setViewportSize({ width: 1280, height: 720 })
    await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(1280)
    await page.screenshot({ path: testInfo.outputPath('settings-1280.png') })
    await page.getByRole('button', { name: 'Accounts', exact: true }).click()
    await page.locator('[data-name="setting-retroAccount"]').click()
    await expect(page.locator('[data-figma-node="credentials-key"]')).toHaveValue('')
    await page.getByRole('button', { name: 'REMOVE SAVED CREDENTIAL' }).click()
    await expect.poll(async () => page.evaluate(async () => (await window.reLauncher!.invoke('catalog:get', undefined)).config.raConfigured)).toBe(false)
  } finally { await closeApp(handle) }
})

test('an exit arriving before the launch reply cannot become a phantom running game', async () => {
  const handle = await launchApp()
  try {
    await ensureMenu(handle.page)
    await handle.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('launch')
      ipcMain.handle('launch', async (event, request: { titleId: string; versionId: string }) => {
        event.sender.send('game:exit', { ...request, exitCode: null, signal: null, requested: false })
        await new Promise((resolve) => setTimeout(resolve, 50))
        return { ok: true, pid: 123, executable: 'fixture', injectedMod: false }
      })
    })
    await handle.page.keyboard.press('Enter')
    await handle.page.keyboard.press('Enter')
    await handle.page.locator('[data-name="row-launch"]').click()
    await expect(handle.page.locator('[data-figma-node="now-playing"]')).toHaveAttribute('data-running', 'false')
  } finally { await closeApp(handle) }
})
