import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const at = new Date('2026-09-22T17:00:00Z').getTime()
const snapshot = {
  fetchedAt: at,
  vehicles: [{ id: '12', name: 'AE-09', routeId: 'TL-7', lat: 33.6462, lon: -117.8244, heading: 120, speedKph: 16, updatedAt: at - 4000 }],
  arrivals: [{ routeId: 'TL-7', stopId: 'TL-2', vehicleId: '12', estimatedAt: at + 5 * 60000 }]
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(at) })
  await page.route('**/api/v1/snapshot', route => route.fulfill({ json: snapshot }))
})

test('shows a quick route and a reliable arrival without permission', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  const started = Date.now()
  await page.goto('/')
  await expect(page.getByTestId('route-card-a-line')).toBeVisible()
  expect(Date.now() - started).toBeLessThan(1800)
  await expect(page.getByText('Daytime service')).toBeVisible()
  await page.getByRole('button', { name: /CDS Stop #1/ }).first().click()
  await expect(page.getByText('5 min', { exact: true }).last()).toBeVisible()
  await page.getByRole('button', { name: 'Save stop' }).click()
  await page.getByRole('button', { name: 'Close full screen map' }).click()
  await page.getByRole('button', { name: 'Saved', exact: true }).click()
  await expect(page.getByRole('button', { name: /CDS Stop #1 A Line/ })).toBeVisible()
})

test('gives boarding side, landmark, route direction, and the official schedule', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  await page.locator('.stop-row').first().click()
  const stop = page.locator('.stop-popover')
  await expect(page.getByRole('button', { name: 'Close full screen map' })).toBeVisible()
  await expect(stop.getByText('University Center side of Campus Drive')).toBeVisible()
  await expect(stop.getByText(/Post Office/)).toBeVisible()
  await expect(stop.getByText(/Next:/).first()).toBeVisible()
  const schedule = stop.getByRole('link', { name: 'Official A Line route and schedule' })
  await expect(schedule).toHaveAttribute('href', 'https://shuttle.uci.edu/routes/a-line/')
  const fitted = await stop.evaluate(sheet => {
    const link = sheet.querySelector('a[href*="shuttle.uci.edu"]')
    if (!(link instanceof HTMLElement)) return false
    const sheetBox = sheet.getBoundingClientRect()
    const linkBox = link.getBoundingClientRect()
    return sheet.scrollWidth - sheet.clientWidth <= 1 && linkBox.right <= sheetBox.right + 1
  })
  expect(fitted).toBe(true)
  const heartAlign = await stop.locator('.save-stop').evaluate(button => {
    const icon = button.querySelector('svg')
    const text = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
    if (!(icon instanceof SVGElement) || !text) return 99
    const range = document.createRange()
    range.selectNodeContents(text)
    const iconBox = icon.getBoundingClientRect()
    const textBox = range.getBoundingClientRect()
    return Math.abs((iconBox.top + iconBox.bottom) / 2 - (textBox.top + textBox.bottom) / 2)
  })
  expect(heartAlign).toBeLessThanOrEqual(2)
  const follow = stop.getByRole('button', { name: /Follow/ }).first()
  const followBox = await follow.boundingBox()
  expect(followBox).toBeTruthy()
  const topElement = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? '', {
    x: followBox!.x + Math.min(24, followBox!.width / 2),
    y: followBox!.y + followBox!.height / 2,
  })
  expect(topElement).toMatch(/Follow/)
})

test('degrades old positions and hides unsupported arrival times', async ({ page }) => {
  await page.route('**/api/v1/snapshot', route => route.fulfill({ json: { ...snapshot, vehicles: [{ ...snapshot.vehicles[0], updatedAt: at - 180000 }] } }))
  await page.goto('/')
  await expect(page.locator('.route-live-status.stale')).toBeVisible()
  await expect(page.locator('.transit-vehicle-marker')).toHaveCount(0)
  await page.getByRole('button', { name: /CDS Stop #1/ }).first().click()
  await expect(page.getByText('Time unavailable').last()).toBeVisible()
})

test('keeps primary actions large and passes automated accessibility checks', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  await expect(page.getByTestId('route-card-a-line')).toBeVisible()
  for (const button of await page.locator('.nav-bar button:visible, .quick-card, .map-control-stack button').all()) {
    const box = await button.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(box?.height).toBeGreaterThanOrEqual(44)
  }
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'wcag22aaa']).analyze()
  expect(scan.violations).toEqual([])
  await page.getByRole('button', { name: 'Routes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'All routes' })).toBeVisible()
})

test('keeps map targets reachable across every route', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.goto('/')
  const layoutReady = () => page.locator('canvas.transit-map-canvas').evaluate(element =>
    Math.abs((element as HTMLCanvasElement).height - element.getBoundingClientRect().height * Math.min(devicePixelRatio, 2)) < 2,
  )
  for (let index = 0; index < 10; index++) {
    await page.getByRole('button', { name: 'Routes', exact: true }).click()
    await expect.poll(layoutReady).toBe(true)
    await page.locator('.all-route-row').nth(index % 5).click()
    await expect.poll(layoutReady).toBe(true)
    await expect(page.locator('.transit-stop-marker').first()).toBeVisible()
    const scan = await new AxeBuilder({ page }).withRules(['target-size']).analyze()
    expect(scan.violations).toEqual([])
  }
})

test('back returns through stop details, route selection, and the previous screen', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Routes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'All routes' })).toBeVisible()
  await page.locator('.all-route-row').first().click()
  await page.locator('.stop-row').first().click()
  await expect(page.locator('.stop-popover')).toBeVisible()
  await page.goBack()
  await expect(page.locator('.stop-popover')).toBeHidden()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'All routes' })).toBeVisible()
  await page.goBack()
  await expect(page.locator('.status-bar')).toBeVisible()
})


test('map controls and stop markers work with keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 })
  await page.goto('/')
  await expect(page.locator('.transit-stop-marker').first()).toBeVisible()
  const before = await page.locator('canvas.transit-map-canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).width)
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Show map movement controls' }).click()
  await page.getByRole('button', { name: 'Move map left' }).click()
  await page.getByRole('button', { name: 'Reset map view and north' }).click()
  const visibleStop = page.locator('.transit-stop-marker:not(.cluster):visible').first()
  await expect(visibleStop).toBeVisible()
  await visibleStop.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.stop-popover')).toBeVisible()
  expect(before).toBeGreaterThan(0)
})

test('shows a usable map and a route choice within a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 })
  await page.goto('/')
  const map = page.locator('canvas.transit-map-canvas')
  await expect(map).toBeVisible()
  await expect(page.locator('.transit-stop-marker:visible').first()).toBeVisible()
  const mapBounds = await map.boundingBox()
  const routeBounds = await page.locator('.quick-card').first().boundingBox()
  expect(mapBounds?.height).toBeGreaterThanOrEqual(340)
  expect(routeBounds && routeBounds.y + routeBounds.height).toBeLessThan(874 - 68)
  await expect(page.getByRole('button', { name: 'All routes', exact: true })).toBeVisible()
  const fullMapButton = page.getByRole('button', { name: 'Expand map' })
  const fullMapWidth = (await fullMapButton.boundingBox())?.width ?? 0
  await fullMapButton.click()
  const doneWidth = (await page.getByRole('button', { name: 'Close full screen map' }).boundingBox())?.width ?? 0
  expect(doneWidth).toBeLessThan(fullMapWidth - 10)
})

test('keeps the first route clear of phone navigation', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Routes', exact: true }).click()
  const route = page.getByRole('button', { name: /A A Line Arroyo Vista/ })
  const routeBounds = await route.boundingBox()
  const navBounds = await page.locator('.nav-bar.inline-tabs').boundingBox()
  expect(routeBounds).not.toBeNull()
  expect(navBounds).not.toBeNull()
  expect(routeBounds!.y + routeBounds!.height).toBeLessThan(navBounds!.y)
  await route.click()
  await expect(page.getByText('Running now')).toBeVisible()
})

test('pinch expands the route while keeping stops interactive', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.locator('.transit-stop-marker').first()).toBeVisible()
  const map = page.locator('.canvas-map-shell')
  const before = Number(await map.getAttribute('data-map-scale'))
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 180, id: 1 }, { x: 290, y: 180, id: 2 }] })
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
      { x: 100 - step * 5, y: 180 - step * 2, id: 1 },
      { x: 290 + step * 5, y: 180 + step * 2, id: 2 },
    ] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const after = Number(await map.getAttribute('data-map-scale'))
  expect(after).toBeGreaterThan(before * 1.2)
  await expect(page.locator('.transit-stop-marker').first()).toBeVisible()
  await context.close()
})

test('keeps the stop list available when the map fails to load', async ({ page }) => {
  await page.route(/\/(?:src\/components\/CanvasTransitMap\.tsx|assets\/CanvasTransitMap-[^/]+\.js)(?:\?.*)?$/, (route) => route.abort())
  await page.goto('/')
  await expect(page.getByText('Map unavailable. Use the stop list.')).toBeVisible()
  await expect(page.locator('.stop-row').first()).toBeVisible()
})

test('opens a full screen map and closes it with Escape and browser back', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 })
  await page.goto('/')
  const map = page.getByRole('region', { name: 'Route map' })
  await page.getByRole('button', { name: 'Expand map' }).click()
  await expect(page.getByRole('button', { name: 'Close full screen map' })).toBeVisible()
  await expect(page.locator('header.topbar')).toBeAttached()
  expect(await page.locator('header.topbar').evaluate(header => getComputedStyle(header).display)).not.toBe('none')
  expect((await map.boundingBox())?.height).toBeGreaterThan(800)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Expand map' })).toBeVisible()
  await expect(page.locator('.info-trigger')).toBeVisible()
  await page.getByRole('button', { name: 'Expand map' }).click()
  await page.goBack()
  await expect(page.getByRole('button', { name: 'Expand map' })).toBeVisible()
  await expect(page.locator('.info-trigger')).toBeVisible()
})

test.describe('client route cache', () => {
  test.use({ serviceWorkers: 'block' })

  test('keeps saved route data during a route feed outage', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('route-card-a-line')).toBeVisible()
    await page.reload()
    await page.route('**/data/routes.min.json', route => route.abort())
    await page.reload()
    await expect(page.getByTestId('route-card-a-line')).toBeVisible()
    await expect(page.getByText('Using saved routes')).toBeVisible()
  })
})

test('opens cached routes and stops without a connection', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByTestId('route-card-a-line')).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('route-card-a-line')).toBeVisible()
  await expect(page.locator('.stop-row').first()).toBeVisible()
})

test('shows the last live update but removes expired arrival times after an outage', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.route-live-status.fresh')).toBeVisible()
  await page.route('**/api/v1/snapshot', route => route.abort())
  await page.reload()
  await expect(page.locator('.route-live-status')).toBeVisible()
  await page.clock.fastForward(120000)
  await page.getByRole('button', { name: /CDS Stop #1/ }).first().click()
  await expect(page.getByText('Time unavailable').last()).toBeVisible()
})

test('pauses the arrival clock while hidden and refreshes it immediately on return', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /CDS Stop #1/ }).first().click()
  await expect(page.getByText('5 min', { exact: true }).last()).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(120000)
  await expect(page.getByText('5 min', { exact: true }).last()).toBeVisible()
  await page.evaluate(() => {
    delete (document as unknown as Record<string, unknown>).visibilityState
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByText('Time unavailable').last()).toBeVisible()
})

test('sends only randomized categories after consent', async ({ page }) => {
  const reports: unknown[] = []
  await page.route('**/api/v1/ux', async route => {
    reports.push(route.request().postDataJSON())
    await route.fulfill({ status: 204 })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'About and settings' }).click()
  await page.getByRole('checkbox', { name: 'Share randomized usage counts' }).check()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Routes', exact: true }).click()
  await page.locator('.all-route-row').first().click()
  await page.locator('.stop-row').first().click()
  await page.clock.runFor(65000)
  expect(reports.length).toBe(1)
  const events = reports[0] as { metric: string, value: number }[]
  expect(events.map(event => Object.keys(event).sort())).toEqual([['metric', 'value'], ['metric', 'value']])
  expect(events.every(event => event.value === 0 || event.value === 1)).toBe(true)
})

test('ignores a late one-time location after Stop', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          setTimeout(() => success({ coords: { latitude: 33.645, longitude: -117.84, accuracy: 10 } } as GeolocationPosition), 2000)
        },
        clearWatch: () => {},
      },
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Locate once' }).click()
  await expect(page.getByText('Finding your position')).toBeVisible()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.clock.fastForward(3000)
  await expect(page.getByText('Off')).toBeVisible()
  await expect(page.locator('.transit-location-marker')).toHaveCount(0)
})

test('uses a full-height desktop map and side navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.transit-stop-marker').first()).toBeVisible()
  const nav = await page.locator('.external-tabs').boundingBox()
  const info = await page.locator('.content-pane').boundingBox()
  const map = await page.locator('.map-pane').boundingBox()
  expect(nav && info && map).toBeTruthy()
  expect(nav!.x + nav!.width).toBeLessThanOrEqual(info!.x + 1)
  expect(map!.height).toBeGreaterThan(750)
  expect(map!.width).toBeGreaterThan(600)
  await page.setViewportSize({ width: 2560, height: 1341 })
  await expect.poll(async () => {
    const shell = await page.locator('.app-shell').boundingBox()
    const wideMap = await page.locator('.map-pane').boundingBox()
    const panel = await page.locator('.content-pane').boundingBox()
    return !!shell && !!wideMap && !!panel && shell.x === 0 && shell.width === 2560
      && Math.abs(wideMap.x + wideMap.width - 2560) < 1 && panel.width <= 510
  }).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(2560)
  await page.getByRole('button', { name: 'Routes', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'All routes' })).toBeVisible()
})

test('shares a ride only after consent and stops the ride session', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  const reports: { id: string; lat: number; lon: number }[] = []
  const ended: string[] = []
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        watchPosition: (success: PositionCallback) => {
          setTimeout(() => success({ coords: { latitude: 33.64932, longitude: -117.83982, accuracy: 12 } } as GeolocationPosition), 0)
          return 1
        },
        clearWatch: () => {},
      },
    })
  })
  await page.route('**/api/v1/rider-signals?route=TL-7', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { signals: [] } })
    const data = route.request().postDataJSON() as { id: string; lat: number; lon: number }
    if (route.request().method() === 'POST') reports.push(data)
    else ended.push(data.id)
    return route.fulfill({ status: 204 })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Share ride' }).first()).toBeVisible()
  expect(reports).toEqual([])
  await page.getByRole('button', { name: 'Expand map' }).click()
  await expect(page.locator('.map-ride-control')).toHaveCount(0)
  expect(reports).toEqual([])
  await page.getByRole('button', { name: 'Close full screen map' }).click()
  await page.getByRole('button', { name: 'Share ride' }).first().click()
  await expect.poll(() => reports.length).toBe(1)
  expect(reports[0].lat).toBe(33.64932)
  await page.getByRole('button', { name: 'Expand map' }).click()
  const share = (await page.locator('.map-ride-control').boundingBox())!
  const controls = (await page.locator('.map-control-stack').boundingBox())!
  expect(share.y).toBeLessThan(controls.y + controls.height)
  await expect(page.locator('.map-ride-control')).toContainText('Sharing this ride')
  await page.getByRole('button', { name: 'Find my location' }).click()
  await expect(page.locator('.map-ride-control')).toContainText('Sharing this ride')
  expect(ended).toEqual([])
  await page.getByRole('button', { name: 'Stop sharing' }).first().click()
  await expect.poll(() => ended).toContain(reports[0].id)
})

test('an active ride stays on the device and alerts at the chosen stop', async ({ page }) => {
  const posts: string[] = []
  await page.addInitScript(() => {
    let current = { latitude: 33.64932, longitude: -117.83982, accuracy: 8 }
    let watcher: PositionCallback | null = null
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => success({ coords: current } as GeolocationPosition),
        watchPosition: (success: PositionCallback) => {
          watcher = success
          success({ coords: current } as GeolocationPosition)
          return 1
        },
        clearWatch: () => { watcher = null },
      },
    })
    ;(window as unknown as { pushFix: (latitude: number, longitude: number) => void }).pushFix = (latitude, longitude) => {
      current = { latitude, longitude, accuracy: 8 }
      watcher?.({ coords: current } as GeolocationPosition)
    }
  })
  await page.route('**/api/v1/rider-signals**', route => {
    if (route.request().method() === 'POST') posts.push('POST')
    return route.fulfill({ status: route.request().method() === 'GET' ? 200 : 204, json: { signals: [] } })
  })
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  await page.getByRole('button', { name: /CDS Stop #1/ }).first().click()
  await page.getByRole('button', { name: 'Follow with this phone' }).click()
  const ride = page.getByRole('region', { name: 'Active ride' })
  await expect(ride).toContainText('Finding your direction on the A Line.')
  await page.clock.fastForward(4000)
  await page.evaluate(() => (window as unknown as { pushFix: (latitude: number, longitude: number) => void }).pushFix(33.64904, -117.83016))
  await expect(ride).toContainText(/stops to CDS Stop #1|Next stop is CDS Stop #1|Your stop is soon/)
  await expect(ride).not.toContainText('Get off')
  await page.clock.fastForward(4000)
  await page.evaluate(() => (window as unknown as { pushFix: (latitude: number, longitude: number) => void }).pushFix(33.6462213807, -117.8243964871))
  await expect(ride).toContainText('Get off at CDS Stop #1')
  expect(posts).toEqual([])
  await page.getByRole('button', { name: 'End ride' }).click()
  await expect(ride).toHaveCount(0)
})

test('a bus ride follows the fleet name the rider selects and does not use this phone', async ({ page }) => {
  const posts: string[] = []
  await page.addInitScript(() => {
    let watches = 0
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: () => {},
        watchPosition: () => { watches += 1; return watches },
        clearWatch: () => {},
      },
    })
    ;(window as unknown as { watchCount: () => number }).watchCount = () => watches
  })
  await page.route('**/api/v1/rider-signals**', route => {
    if (route.request().method() === 'POST') posts.push('POST')
    return route.fulfill({ status: route.request().method() === 'GET' ? 200 : 204, json: { signals: [] } })
  })
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  await page.getByRole('button', { name: /CDS Stop #1/ }).first().click()
  const follow = page.getByRole('button', { name: /Follow AE-09/ })
  await expect(follow).toBeVisible()
  await expect(follow).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: /nearest/i })).toHaveCount(0)
  await follow.click()
  const ride = page.getByRole('region', { name: 'Active ride' })
  await expect(ride).toContainText('Following AE-09, not this phone')
  await expect(ride).toContainText('A late position can make this alert early or late')
  expect(await page.evaluate(() => (window as unknown as { watchCount: () => number }).watchCount())).toBe(0)
  expect(posts).toEqual([])
})

test('tapping a bus on the map shows the fleet name and asks for the stop', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand map' }).click()
  await page.getByRole('button', { name: 'AE-09 on the A Line, heading southeast. Show this bus' }).click()
  await expect(page.getByRole('dialog', { name: 'Bus AE-09' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'This bus only' })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'This bus only' }).click()
  await expect(page.getByRole('button', { name: 'Get off at CDS Stop #1' })).toBeVisible()
})

test('swipes between top-level tabs without taking over vertical scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Routes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'All routes' })).toBeVisible()
  const cdp = await page.context().newCDPSession(page)
  const title = page.locator('.page-head h2')
  await title.scrollIntoViewIfNeeded()
  const titleBox = await title.boundingBox()
  expect(titleBox).toBeTruthy()
  const titleY = titleBox!.y + titleBox!.height / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: titleY, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: titleY + 100, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByRole('heading', { name: 'All routes' })).toBeVisible()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: titleY, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120, y: titleY + 8, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByText('Nothing saved yet')).toBeVisible()
})

test('a horizontal drag starting on a route control does not switch tabs', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Routes', exact: true }).click()
  const route = page.locator('.all-route-row').first()
  await route.scrollIntoViewIfNeeded()
  const box = await route.boundingBox()
  expect(box).toBeTruthy()
  const x = box!.x + box!.width * 0.72
  const y = box!.y + box!.height / 2
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 110, y, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByRole('heading', { name: 'All routes' })).toBeVisible()
})

test('pans when a drag begins on a stop marker', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 })
  await page.goto('/')
  const marker = page.locator('.transit-stop-marker:visible').first()
  await expect(marker).toBeVisible()
  const box = await marker.boundingBox()
  expect(box).toBeTruthy()
  const before = await marker.evaluate(element => parseFloat((element as HTMLElement).style.left))
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
  for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + step * 14, y, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const after = await marker.evaluate(element => parseFloat((element as HTMLElement).style.left))
  expect(after - before).toBeGreaterThan(20)
  await expect(page.locator('.stop-popover')).toBeHidden()
})

test('compares chosen routes and combines arrivals only at stops they serve', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await page.route('**/api/v1/snapshot', route => route.fulfill({ json: {
    fetchedAt: at,
    vehicles: [
      ...snapshot.vehicles,
      { id: '14', routeId: 'TL-4', lat: 33.6463, lon: -117.8243, heading: 120, speedKph: 14, updatedAt: at - 4000 },
      { id: '16', routeId: 'TL-6', lat: 33.6491, lon: -117.8388, heading: 120, speedKph: 14, updatedAt: at - 4000 },
    ],
    arrivals: [
      ...snapshot.arrivals,
      { routeId: 'TL-4', stopId: 'TL-2', vehicleId: '14', estimatedAt: at + 8 * 60000 },
    ],
  } }))
  await page.goto('/')
  await page.getByRole('button', { name: /Routes on map:.*Change routes/ }).click()
  await page.getByRole('button', { name: 'Show H Line on map' }).click()
  await page.getByRole('button', { name: 'Show N Line on map' }).click()
  await expect(page.locator('.transit-vehicle-marker')).toHaveCount(3)
  await page.getByRole('button', { name: 'Close route choices' }).click()
  await page.getByRole('button', { name: 'Close full screen map' }).click()
  await page.getByRole('button', { name: /CDS Stop #1/ }).first().click()
  const arrivals = page.locator('.stop-route-arrival')
  await expect(arrivals).toHaveCount(2)
  await expect(arrivals.nth(0)).toContainText('A Line')
  await expect(arrivals.nth(1)).toContainText('H Line')
  await expect(arrivals.filter({ hasText: 'N Line' })).toHaveCount(0)
  await expect(page.locator('.stop-route-arrival').filter({ hasText: '8 min' })).toBeVisible()
})

test('saves a named route and stop view, then restores it on launch', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  await page.getByRole('button', { name: /CDS Stop #1/ }).first().click()
  await page.getByRole('button', { name: 'Watch stop' }).click()
  await page.getByRole('button', { name: 'Close stop details' }).click()
  await page.getByRole('button', { name: 'Close full screen map' }).click()
  await page.getByRole('button', { name: /Routes on map:.*Change routes/ }).click()
  await page.getByRole('button', { name: 'Show H Line on map' }).click()
  await page.getByRole('button', { name: 'Show N Line on map' }).click()
  await page.getByRole('button', { name: 'Save this view' }).click()
  await page.getByRole('textbox', { name: 'View name' }).fill('Home buses')
  await page.locator('.map-save-view').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Home buses saved')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: /Routes on map: A Line, H Line, N Line/ })).toBeVisible()
  const closeMap = page.getByRole('button', { name: 'Close full screen map' })
  if (await closeMap.isVisible()) await closeMap.click()
  await expect(page.locator('.watch-board')).toContainText('CDS Stop #1')
  await page.getByRole('button', { name: 'Saved', exact: true }).click()
  await expect(page.getByRole('button', { name: /Home buses.*A · H · N/ })).toBeVisible()
  await page.getByRole('button', { name: 'Rename Home buses' }).click()
  await page.getByRole('textbox', { name: 'Name for Home buses' }).fill('Apartment routes')
  await page.locator('.saved-view-row form').getByRole('button', { name: 'Save' }).click()
  await page.locator('.saved-view-open').filter({ hasText: 'Apartment routes' }).click()
  await expect(page.locator('.watch-board')).toContainText('CDS Stop #1')
})


test('map controls accept drags and pinches without activating their buttons', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true })
  const page = await context.newPage()
  await page.route('**/api/v1/snapshot', route => route.fulfill({ json: snapshot }))
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')
  const map = page.locator('.canvas-map-shell')
  await expect(page.locator('.transit-stop-marker').first()).toBeVisible()
  const cdp = await page.context().newCDPSession(page)
  for (const name of ['Zoom in', 'Zoom out', 'Find my location', 'Show map movement controls', 'Expand map', /Routes on map:.*Change routes/]) {
    const button = page.getByRole('button', { name, exact: true })
    const box = await button.boundingBox()
    expect(box).toBeTruthy()
    const x = box!.x + box!.width / 2
    const y = box!.y + box!.height / 2
    const scale = Number(await map.getAttribute('data-map-scale'))
    const before = Number((await map.getAttribute('data-map-center'))!.split(',')[0])
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
    for (let step = 1; step <= 5; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - step * 12, y: y - step * 3, id: 1 }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(async () => Number((await map.getAttribute('data-map-center'))!.split(',')[0])).toBeGreaterThan(before + 40 / scale)
    expect(Number(await map.getAttribute('data-map-scale'))).toBe(scale)
    await expect(page.getByRole('button', { name: 'Expand map', exact: true })).toBeVisible()
    await expect(page.locator('.map-pan-pad')).toBeHidden()
  }
  const zoom = page.getByRole('button', { name: 'Zoom in', exact: true })
  const box = (await zoom.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const scale = Number(await map.getAttribute('data-map-scale'))
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }, { x: x - 110, y, id: 2 }] })
  for (let step = 1; step <= 5; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + step * 5, id: 1 }, { x: x - 110 - step * 12, y, id: 2 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(async () => Number(await map.getAttribute('data-map-scale'))).toBeGreaterThan(scale * 1.3)
  const out = (await page.getByRole('button', { name: 'Zoom out', exact: true }).boundingBox())!
  const outX = out.x + out.width / 2
  const outY = out.y + out.height / 2
  const beforeInward = Number(await map.getAttribute('data-map-scale'))
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }, { x: outX, y: outY, id: 2 }] })
  for (let step = 1; step <= 5; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }, { x: outX, y: outY - step * 5, id: 2 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(async () => Number(await map.getAttribute('data-map-scale'))).toBeLessThan(beforeInward * 0.7)
  const afterPinch = Number(await map.getAttribute('data-map-scale'))
  await zoom.tap()
  await expect.poll(async () => Number(await map.getAttribute('data-map-scale'))).toBeCloseTo(afterPinch * 1.25, 4)
  const afterTap = Number(await map.getAttribute('data-map-scale'))
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  expect(Number(await map.getAttribute('data-map-scale'))).toBe(afterTap)
  await zoom.tap()
  await expect.poll(async () => Number(await map.getAttribute('data-map-scale'))).toBeCloseTo(afterTap * 1.25, 4)
  await page.getByRole('button', { name: 'Expand map', exact: true }).tap()
  await expect(page.getByRole('button', { name: 'Close full screen map' })).toBeVisible()
  await context.close()
})

test('keeps compact controls inside generous touch areas across screen sizes', async ({ page }) => {
  for (const width of [320, 412, 1440]) {
    await page.setViewportSize({ width, height: 915 })
    await page.goto('/')
    await expect(page.locator('.transit-stop-marker').first()).toBeVisible()
    for (const screen of ['Nearby', 'Routes', 'Saved']) {
      await page.getByRole('button', { name: screen, exact: true }).click()
      const undersized = await page.locator('button:visible:not(.transit-stop-marker), .official-link:visible, .info-section a:visible, .search-field input:visible').evaluateAll(elements => elements.filter(element => {
        const box = element.getBoundingClientRect()
        return box.width < 48 || box.height < 48
      }).map(element => element.getAttribute('aria-label') || element.textContent))
      expect(undersized).toEqual([])
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  }
})


test('full screen map panels stay clear of navigation across sizes and text scaling', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand map' }).click()
  for (const viewport of [{ width: 320, height: 640 }, { width: 412, height: 800 }, { width: 740, height: 360 }]) {
    await page.setViewportSize(viewport)
    await page.getByRole('button', { name: 'Show map movement controls' }).click()
    const toggle = page.getByRole('button', { name: 'Hide map movement controls' })
    const pad = (await page.locator('.map-pan-pad').boundingBox())!
    const controls = (await page.locator('.map-control-stack').boundingBox())!
    expect(pad.y + pad.height <= controls.y || pad.x + pad.width <= controls.x).toBe(true)
    for (const button of await page.locator('.map-navigation button').all()) {
      await button.focus()
      expect(await button.evaluate(element => {
        const box = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
      })).toBe(true)
    }
    await toggle.focus()
    await page.keyboard.press('Escape')
    await expect(page.locator('.map-pan-pad')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Show map movement controls' })).toBeFocused()
    await expect(page.getByRole('button', { name: 'Close full screen map' })).toBeVisible()
    await page.getByRole('button', { name: /Routes on map:.*Change routes/ }).click()
    const picker = (await page.locator('.map-route-picker').boundingBox())!
    const toolbar = (await page.locator('.map-control-stack').boundingBox())!
    expect(picker.y + picker.height).toBeLessThanOrEqual(toolbar.y)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /Routes on map:.*Change routes/ })).toBeFocused()
  }
  await page.setViewportSize({ width: 320, height: 640 })
  await page.addStyleTag({ content: '.map-control-stack button { font-size: 22px }' })
  const nav = (await page.locator('.map-control-stack').boundingBox())!
  expect(nav.x).toBeGreaterThanOrEqual(0)
  expect(nav.x + nav.width).toBeLessThanOrEqual(320)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
})


test('full screen map reports failed live updates without suggesting an empty fleet', async ({ page }) => {
  await page.route('**/api/v1/snapshot', route => route.fulfill({ status: 502 }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand map' }).click()
  await expect(page.locator('#map-live-status')).toContainText('Live updates unavailable')
  await expect(page.locator('.map-ride-control')).toHaveCount(0)
})

test('transit remains usable when browser storage cannot be written', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage unavailable', 'QuotaExceededError') }
  })
  await page.goto('/')
  await expect(page.locator('.transit-vehicle-marker')).toBeVisible()
  await page.getByRole('button', { name: 'Expand map' }).click()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.clock.runFor(500)
  await expect(page.locator('.transit-vehicle-marker')).toBeVisible()
  await expect(page.locator('#map-live-status')).not.toContainText('unavailable')
})


test.describe('street map failure recovery', () => {
  test.use({ serviceWorkers: 'block' })
  test('keeps routes usable and offers a retry when street details fail', async ({ page }) => {
    await page.route('**/data/roads.geojson', route => route.fulfill({ status: 503 }))
    await page.goto('/')
    await expect(page.getByText('Street details unavailable')).toBeVisible()
    await expect(page.locator('.transit-stop-marker').first()).toBeVisible()
    await page.getByRole('button', { name: /Routes on map:.*Change routes/ }).click()
    await page.unroute('**/data/roads.geojson')
    await page.getByRole('button', { name: 'Retry street map' }).click()
    await expect(page.getByText('Street details unavailable')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Retry street map' })).toBeHidden()
  })
})


test('map location control centers a fix but respects a later camera adjustment', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: {
      getCurrentPosition: (success: PositionCallback) => {
        const state = window as unknown as { fixRequests?: number; deliverFix: () => void }
        state.fixRequests = (state.fixRequests || 0) + 1
        state.deliverFix = () => success({ coords: { latitude: 33.645556, longitude: -117.8425, accuracy: 12 } } as GeolocationPosition)
      },
      clearWatch: () => {},
    } })
  })
  await page.setViewportSize({ width: 412, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand map' }).click()
  const map = page.locator('.canvas-map-shell')
  await page.getByRole('button', { name: 'Find my location' }).click()
  await page.waitForFunction(() => typeof (window as unknown as { deliverFix: unknown }).deliverFix === 'function')
  await page.evaluate(() => (window as unknown as { deliverFix: () => void }).deliverFix())
  await expect.poll(async () => (await map.getAttribute('data-map-center'))!.split(',').map(Number)).toEqual([0, 0])
  const dot = (await page.locator('.transit-location-marker').boundingBox())!
  const box = (await map.boundingBox())!
  expect(dot.x + dot.width / 2).toBeCloseTo(box.x + box.width / 2, 1)
  expect(dot.y + dot.height / 2).toBeCloseTo(box.y + box.height / 2, 1)
  await page.getByRole('button', { name: 'Find my location' }).click()
  await page.getByRole('button', { name: 'Show map movement controls' }).click()
  await page.getByRole('button', { name: 'Move map right' }).click()
  await page.waitForFunction(() => (window as unknown as { fixRequests: number }).fixRequests === 2)
  const adjusted = await map.getAttribute('data-map-center')
  await page.evaluate(() => (window as unknown as { deliverFix: () => void }).deliverFix())
  await expect(page.locator('.map-location-notice')).toHaveText('Location found. Map position kept.')
  expect(await map.getAttribute('data-map-center')).toBe(adjusted)
})


test('failed full screen maps provide a visible return to the stop list', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 800 })
  await page.route(/\/(?:src\/components\/CanvasTransitMap\.tsx|assets\/CanvasTransitMap-[^/]+\.js)(?:\?.*)?$/, route => route.abort())
  await page.goto('/')
  await expect(page.getByText('Map unavailable. Use the stop list.')).toBeVisible()
  await page.locator('.stop-row').first().click()
  await page.getByRole('button', { name: 'Show stops', exact: true }).click()
  await expect(page.locator('.content-pane')).toBeVisible()
  await expect(page.locator('.stop-row').first()).toBeVisible()
})


test('bus headings rotate with the map and movement arrows follow the camera direction', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand map' }).click()
  const map = page.locator('.canvas-map-shell')
  const marker = page.locator('.transit-vehicle-marker').first()
  const heading = () => marker.evaluate(element => parseFloat((element as HTMLElement).style.getPropertyValue('--heading')))
  const before = await heading()
  const box = (await map.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 60, y, id: 1 }, { x: x + 60, y, id: 2 }] })
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 60 + step * 7.5, y: y - step * 7.5, id: 1 }, { x: x + 60 - step * 7.5, y: y + step * 7.5, id: 2 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(heading).toBeCloseTo(before + 90, 3)
  await page.getByRole('button', { name: 'Show map movement controls' }).click()
  await page.getByRole('button', { name: 'Reset map view and north' }).click()
  await expect.poll(heading).toBeCloseTo(before, 3)
  const center = () => map.getAttribute('data-map-center').then(value => Number(value!.split(',')[0]))
  const origin = await center()
  await page.getByRole('button', { name: 'Move map right' }).click()
  await expect.poll(center).toBeGreaterThan(origin)
  await page.getByRole('button', { name: 'Move map left' }).click()
  await expect.poll(center).toBeCloseTo(origin, 3)
})

test('a reported bus stays on its route line as the map moves', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const bus = page.locator('.transit-vehicle-marker')
  await expect(bus).toBeVisible()
  await expect(bus.locator('.vehicle-letter')).toHaveText('A')
  await expect(bus.locator('.vehicle-number')).toHaveText('09')
  await expect(bus).not.toContainText('AE-09')
  const letterBox = (await bus.locator('.vehicle-letter').boundingBox())!
  const numberBox = (await bus.locator('.vehicle-number').boundingBox())!
  expect(Math.abs((letterBox.x + letterBox.width / 2) - (numberBox.x + numberBox.width / 2))).toBeLessThan(2)
  expect(numberBox.y).toBeGreaterThan(letterBox.y + letterBox.height)
  expect(numberBox.height).toBeLessThan(letterBox.height)
  const onRoutePaint = async () => {
    const marker = (await bus.locator('.vehicle-badge').boundingBox())!
    return page.locator('canvas.transit-map-canvas').evaluate((canvas, point) => {
      const element = canvas as HTMLCanvasElement
      const rect = element.getBoundingClientRect()
      const ratio = element.width / rect.width
      const context = element.getContext('2d')
      if (!context) return false
      const cx = Math.round((point.x - rect.x) * ratio)
      const cy = Math.round((point.y - rect.y) * ratio)
      const radius = Math.max(2, Math.ceil(ratio * 3))
      const data = context.getImageData(cx - radius, cy - radius, radius * 2 + 1, radius * 2 + 1).data
      for (let index = 0; index < data.length; index += 4) {
        const [red, green, blue] = [data[index], data[index + 1], data[index + 2]]
        const routeYellow = red > 220 && green > 200 && blue < 130
        const routeCasing = red < 60 && green > red && green < 90 && blue < 80
        if (routeYellow || routeCasing) return true
      }
      return false
    }, { x: marker.x + marker.width / 2, y: marker.y + marker.height / 2 })
  }
  expect(await onRoutePaint()).toBe(true)
  const credit = await page.locator('.map-attribution').boundingBox()
  const expand = await page.getByRole('button', { name: 'Expand map' }).boundingBox()
  expect(credit && expand && credit.y + credit.height < expand.y).toBe(true)
  await page.setViewportSize({ width: 1280, height: 800 })
  const wideCredit = await page.locator('.map-attribution').boundingBox()
  const wideExpand = await page.getByRole('button', { name: 'Expand map' }).boundingBox()
  expect(wideCredit && wideExpand && wideCredit.y + wideCredit.height < wideExpand.y).toBe(true)
  expect(await onRoutePaint()).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  expect(await onRoutePaint()).toBe(true)
  await page.getByRole('button', { name: 'Show map movement controls' }).click()
  const before = (await bus.boundingBox())!
  await page.getByRole('button', { name: 'Move map right' }).click()
  const after = (await bus.boundingBox())!
  expect(after.x - before.x).toBeCloseTo(-120, 0)
  expect(after.y).toBeCloseTo(before.y, 0)
  expect(await onRoutePaint()).toBe(true)
})

test('Escape closes about without leaving the current screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'About and settings' }).click()
  await expect(page.getByRole('dialog', { name: 'About ZotStop' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'About ZotStop' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Nearby', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'About and settings' }).click()
  const sheet = page.locator('.info-sheet')
  const box = (await sheet.boundingBox())!
  expect(box.y).toBeGreaterThan(20)
  expect(box.y + box.height).toBeLessThan(780)
  expect(Math.abs((800 - box.height) / 2 - box.y)).toBeLessThan(16)
  expect(box.width).toBeLessThan(900)
  expect(box.x).toBeGreaterThan(40)
  await expect(sheet.getByRole('heading', { name: 'About live times' })).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Service information' })).toBeVisible()
  const note = (await sheet.locator('.independence-note').boundingBox())!
  expect(note.y).toBeGreaterThanOrEqual(box.y)
  expect(note.y + note.height).toBeLessThanOrEqual(box.y + box.height + 1)
})

test('stop dots stay small while the hit area grows, and a bus arrow has one nose', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand map' }).click()
  const marker = page.locator('.transit-stop-marker').first()
  await expect(marker).toBeVisible()
  const hit = await marker.boundingBox()
  const dot = await marker.locator('.stop-marker-dot').boundingBox()
  expect(hit?.width).toBeGreaterThanOrEqual(32)
  expect(hit?.height).toBeGreaterThanOrEqual(32)
  expect(dot?.width).toBeLessThan(hit!.width)
  expect(dot?.height).toBeLessThan(hit!.height)
  const plain = page.locator('.transit-stop-marker:not(.cluster) .stop-marker-dot').first()
  if (await plain.count()) expect((await plain.boundingBox())?.width).toBeLessThanOrEqual(14)
  const arrow = page.locator('.vehicle-heading').first()
  await expect(arrow).toBeVisible()
  const arrowSize = await arrow.evaluate(element => {
    if (!(element instanceof HTMLElement)) throw new Error('Bus direction mark is missing')
    return { width: element.offsetWidth, height: element.offsetHeight }
  })
  expect(arrowSize.height).toBeGreaterThan(arrowSize.width * 1.4)
  const clip = await arrow.evaluate(element => getComputedStyle(element).clipPath)
  expect((clip.match(/,/g) ?? []).length).toBeGreaterThanOrEqual(5)
  await expect(page.getByRole('button', { name: /AE-09 on the A Line, heading southeast/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Map', exact: true })).toHaveCount(0)
})

test('pulling down at the top of a list stretches the map, and the handle pulls it back', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 })
  await page.goto('/')
  await expect(page.getByText('Running now')).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  const status = page.locator('.status-bar')
  const box = await status.boundingBox()
  expect(box).toBeTruthy()
  const x = box!.x + 28
  const y = box!.y + box!.height / 2
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + step * 22, id: 1 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByRole('button', { name: 'Close full screen map' })).toBeVisible()
  const handle = page.getByRole('button', { name: 'Drag up to leave the full screen map' })
  await expect(handle).toBeVisible()
  const handleBox = await handle.boundingBox()
  expect(handleBox).toBeTruthy()
  const hx = handleBox!.x + handleBox!.width / 2
  const hy = handleBox!.y + handleBox!.height / 2
  await page.mouse.move(hx, hy)
  await page.mouse.down()
  await page.mouse.move(hx, hy - 240, { steps: 10 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Expand map' })).toBeVisible()
  await expect(page.getByText('Running now')).toBeVisible()
})

test('campus departures lead nearby without a location fix', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Campus departures' })).toBeVisible()
  await expect(page.getByText('Running now')).toBeVisible()
})

test('a closed service day replaces departures and running lines', async ({ page }) => {
  const sunday = Date.parse('2026-09-27T17:00:00Z')
  await page.clock.setFixedTime(new Date(sunday))
  await page.route('**/api/v1/snapshot', route => route.fulfill({
    json: {
      ...snapshot,
      fetchedAt: sunday,
      vehicles: [{ ...snapshot.vehicles[0], updatedAt: sunday - 4000 }],
      arrivals: [{ ...snapshot.arrivals[0], estimatedAt: sunday + 5 * 60000 }],
    },
  }))
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  await expect(page.locator('.service-closed')).toContainText('No weekend service')
  await expect(page.getByRole('region', { name: 'Campus departures' })).toHaveCount(0)
  await expect(page.getByTestId('route-card-a-line')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Operator updates' })).toHaveAttribute('href', 'https://shuttle.uci.edu/ride/updates-and-faqs/')
})

test('location controls stay above the navigation bar', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  const button = page.getByRole('button', { name: 'Locate once' })
  await button.evaluate(element => element.scrollIntoView({ block: 'end' }))
  const box = await button.boundingBox()
  expect(box).toBeTruthy()
  const nav = await page.locator('.nav-bar.inline-tabs').boundingBox()
  expect(nav).toBeTruthy()
  expect(box!.y + box!.height).toBeLessThanOrEqual(nav!.y + 1)
  expect(box!.y + box!.height / 2).toBeLessThan(nav!.y)
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? '', {
    x: box!.x + box!.width / 2,
    y: box!.y + box!.height / 2,
  })
  expect(hit).toMatch(/Locate once/)
})

test('search finds a stop by its landmark, remembers it, and a link reopens it', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  const search = page.getByRole('combobox', { name: 'Search stops and lines' })
  await search.fill('Anteater Recreation')
  await page.getByRole('option', { name: /California - Adobe Circle South/ }).click()
  await expect(page.locator('.stop-popover')).toContainText('California - Adobe Circle South')
  expect(page.url()).toContain('stop=TL-21')
  expect(page.url()).not.toMatch(/lat=|lon=/)
  await page.getByRole('button', { name: 'Close full screen map' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('zotstop-recent-stops'))).toContain('TL-21')
  await search.click()
  await expect(page.getByText('Recent stops')).toBeVisible()
  await expect(page.getByRole('option', { name: /California - Adobe Circle South/ })).toBeVisible()
  await page.goto('/?stop=TL-2&route=TL-7')
  await expect(page.locator('.stop-popover')).toContainText('CDS Stop #1')
  expect(page.url()).not.toMatch(/lat=|lon=/)
})

test('a stop sheet moves the stop out from under it, and zoom keeps the nose readable', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand map' }).click()
  const arrow = page.locator('.vehicle-heading').first()
  const before = await arrow.evaluate(element => element instanceof HTMLElement ? element.offsetHeight : 0)
  for (let step = 0; step < 4; step++) await page.getByRole('button', { name: 'Zoom in' }).click()
  const after = await arrow.evaluate(element => {
    if (!(element instanceof HTMLElement)) throw new Error('Bus direction mark is missing')
    return { width: element.offsetWidth, height: element.offsetHeight }
  })
  expect(after.height).toBeGreaterThan(after.width * 1.4)
  expect(after.height).toBeLessThanOrEqual(before)
  await page.getByRole('button', { name: /AE-09 on the A Line/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Bus AE-09' })
  await expect(dialog.getByText('Upcoming stops')).toBeVisible()
  await expect(dialog.locator('.upcoming-stops li').first()).not.toBeEmpty()
  await page.goto('/')
  await page.getByRole('button', { name: /University Center North/ }).first().click()
  const popover = page.locator('.stop-popover')
  const marker = page.locator('.transit-stop-marker.selected')
  await expect(popover).toBeVisible()
  await expect(marker).toBeVisible()
  await expect.poll(async () => {
    const sheet = await popover.boundingBox()
    const point = await marker.boundingBox()
    const map = await page.locator('.map-pane').boundingBox()
    if (!sheet || !point || !map) return false
    const insideMap = point.x + point.width / 2 > map.x && point.x + point.width / 2 < map.x + map.width && point.y + point.height / 2 > map.y && point.y + point.height / 2 < map.y + map.height
    const overlaps = point.x < sheet.x + sheet.width && point.x + point.width > sheet.x && point.y < sheet.y + sheet.height && point.y + point.height > sheet.y
    return insideMap && !overlaps
  }).toBe(true)
})

test('a wrong phone clock is named and arrivals follow the operator report', async ({ page }) => {
  const skewedAt = at - 120_000
  await page.route('**/api/v1/snapshot', route => route.fulfill({
    json: {
      fetchedAt: skewedAt,
      vehicles: [{ id: '12', name: 'AE-09', routeId: 'TL-7', lat: 33.6462, lon: -117.8244, heading: 120, speedKph: 16, updatedAt: skewedAt - 4000 }],
      arrivals: [{ routeId: 'TL-7', stopId: 'TL-2', vehicleId: '12', estimatedAt: skewedAt + 5 * 60000 }],
    },
  }))
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  await expect(page.getByText("This phone's clock looks wrong. Times follow the operator report.")).toBeVisible()
  await page.getByRole('button', { name: /CDS Stop #1/ }).first().click()
  await expect(page.getByText('5 min', { exact: true }).last()).toBeVisible()
})

test('dark surfaces keep the operator route color', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  const pageColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(pageColor).toBe('rgb(18, 21, 26)')
  const badge = page.getByTestId('route-card-a-line').locator('.route-badge')
  await expect(badge).toBeVisible()
  const fill = await badge.evaluate(element => getComputedStyle(element).backgroundColor)
  expect(fill).toBe('rgb(251, 241, 64)')
})
