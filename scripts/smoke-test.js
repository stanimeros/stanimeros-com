#!/usr/bin/env node
/**
 * Post-deployment smoke test: hits every route on the live site and checks
 * it responds correctly — status code, correct <html lang>, a non-empty
 * <title>, and (for redirects) the right Location target. Not a substitute
 * for real e2e tests; just a fast "did the deploy actually work" check.
 *
 * Run: npm run smoke-test [baseUrl]
 * Defaults to https://stanimeros.com
 */

const baseUrl = (process.argv[2] || 'https://stanimeros.com').replace(/\/$/, '')

const appSlugs = ['atpro-partner', 'e-karotsi', 'ski-greece', 'fire-message', 'chronal', 'nourea', 'party', 'statwise']
const downloadSlugs = ['party', 'chronal', 'ski-greece', 'fire-message', 'tattoo-healer', 'atpro-partner', 'hedeos', 'statwise']
const projectSlugs = ['statwise', 'party', 'nourea', 'chronal', 'irisdrop']

// { path, lang, redirectTo } — pages are checked for status/lang/title,
// redirects are checked for status 301 and the right Location header.
const pages = [
  { path: '/', lang: 'en' },
  { path: '/about', lang: 'en' },
  { path: '/services', lang: 'en' },
  { path: '/projects', lang: 'en' },
  { path: '/contact', lang: 'en' },
  { path: '/privacy-policy', lang: 'en' },
  { path: '/data-deletion', lang: 'en' },
  // Internal dashboard: the static shell is public (the data behind it isn't),
  // so it's checked like any other page — a 200 and a title.
  { path: '/health', lang: 'en' },
  ...appSlugs.map((slug) => ({ path: `/data-deletion/${slug}`, lang: 'en' })),
  ...appSlugs.map((slug) => ({ path: `/privacy-policy/${slug}`, lang: 'en' })),
  ...downloadSlugs.map((slug) => ({ path: `/${slug}`, lang: 'en' })),
  ...projectSlugs.map((slug) => ({ path: `/projects/${slug}`, lang: 'en' })),
  { path: '/el', lang: 'el' },
  { path: '/el/about', lang: 'el' },
  { path: '/el/services', lang: 'el' },
  { path: '/el/projects', lang: 'el' },
  { path: '/el/contact', lang: 'el' },
  { path: '/el/privacy-policy', lang: 'el' },
  { path: '/el/data-deletion', lang: 'el' },
  ...appSlugs.map((slug) => ({ path: `/el/data-deletion/${slug}`, lang: 'el' })),
  ...appSlugs.map((slug) => ({ path: `/el/privacy-policy/${slug}`, lang: 'el' })),
  ...projectSlugs.map((slug) => ({ path: `/el/projects/${slug}`, lang: 'el' })),
]

const redirects = [
  { path: '/terms', to: '/privacy-policy' },
  { path: '/privacy', to: '/privacy-policy' },
  { path: '/portfolio', to: '/projects' },
  { path: '/el/portfolio', to: '/el/projects' },
  { path: '/work/party', to: '/projects/party' },
  { path: '/el/work/party', to: '/el/projects/party' },
  { path: '/en', to: '/' },
]

const notFoundPaths = ['/this-page-does-not-exist']

let failures = 0

function report(ok, label, detail) {
  if (ok) {
    console.log(`  \x1b[32m✔\x1b[0m ${label}`)
  } else {
    failures += 1
    console.log(`  \x1b[31m✘\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function checkPage({ path, lang }) {
  const url = `${baseUrl}${path}`
  let res
  try {
    res = await fetch(url, { redirect: 'manual' })
  } catch (error) {
    report(false, path, `request failed: ${error.message}`)
    return
  }

  if (res.status !== 200) {
    report(false, path, `expected 200, got ${res.status}`)
    return
  }

  const html = await res.text()

  const langMatch = html.match(/<html[^>]*\blang="([^"]+)"/i)
  const langOk = langMatch?.[1] === lang
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i)
  const titleOk = !!titleMatch?.[1]?.trim()

  if (!langOk) {
    report(false, path, `expected lang="${lang}", got ${langMatch ? `"${langMatch[1]}"` : 'no lang attribute'}`)
    return
  }
  if (!titleOk) {
    report(false, path, 'missing or empty <title>')
    return
  }

  report(true, path)
}

async function checkRedirect({ path, to }) {
  const url = `${baseUrl}${path}`
  let res
  try {
    res = await fetch(url, { redirect: 'manual' })
  } catch (error) {
    report(false, `${path} → ${to}`, `request failed: ${error.message}`)
    return
  }

  const location = res.headers.get('location')
  const locationPath = location ? new URL(location, baseUrl).pathname.replace(/\/$/, '') || '/' : null

  if (![301, 302, 308].includes(res.status) || locationPath !== to) {
    report(false, `${path} → ${to}`, `got status ${res.status}, location "${location}"`)
    return
  }

  report(true, `${path} → ${to}`)
}

async function checkNotFound(path) {
  const url = `${baseUrl}${path}`
  let res
  try {
    res = await fetch(url, { redirect: 'manual' })
  } catch (error) {
    report(false, path, `request failed: ${error.message}`)
    return
  }

  if (res.status !== 404) {
    report(false, path, `expected 404, got ${res.status}`)
    return
  }

  report(true, `${path} (404)`)
}

async function main() {
  console.log(`Smoke testing ${baseUrl}\n`)

  console.log('Pages:')
  for (const page of pages) await checkPage(page)

  console.log('\nRedirects:')
  for (const redirect of redirects) await checkRedirect(redirect)

  console.log('\n404 handling:')
  for (const path of notFoundPaths) await checkNotFound(path)

  console.log(`\n${pages.length + redirects.length + notFoundPaths.length - failures}/${pages.length + redirects.length + notFoundPaths.length} checks passed`)

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed.`)
    process.exit(1)
  }
}

main()
