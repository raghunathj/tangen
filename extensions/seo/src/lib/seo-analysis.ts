export type SeoScore = 'good' | 'ok' | 'poor'

export interface SeoCheck {
  key: string
  label: string
  score: SeoScore
  message: string
}

// ── Title length ──────────────────────────────────────────────────────────────

export function analyzeTitleLength(title: string): SeoCheck {
  const len = title.trim().length
  let score: SeoScore
  let message: string

  if (len === 0) {
    score = 'poor'
    message = 'SEO title is missing.'
  } else if (len < 10) {
    score = 'poor'
    message = `SEO title is too short (${len} chars). Aim for 50–60 characters.`
  } else if (len > 70) {
    score = 'poor'
    message = `SEO title is too long (${len} chars). Keep it under 70 characters.`
  } else if (len >= 50 && len <= 60) {
    score = 'good'
    message = `SEO title length is ideal (${len} chars).`
  } else {
    score = 'ok'
    message = len < 50
      ? `SEO title is a bit short (${len} chars). Aim for 50–60 characters.`
      : `SEO title is a bit long (${len} chars). Try to keep it under 60 characters.`
  }

  return { key: 'title-length', label: 'SEO title length', score, message }
}

// ── Meta description length ───────────────────────────────────────────────────

export function analyzeMetaDescLength(desc: string): SeoCheck {
  const len = desc.trim().length
  let score: SeoScore
  let message: string

  if (len === 0) {
    score = 'poor'
    message = 'Meta description is missing.'
  } else if (len < 50) {
    score = 'poor'
    message = `Meta description is too short (${len} chars). Aim for 120–160 characters.`
  } else if (len > 180) {
    score = 'poor'
    message = `Meta description is too long (${len} chars). Keep it under 180 characters.`
  } else if (len >= 120 && len <= 160) {
    score = 'good'
    message = `Meta description length is ideal (${len} chars).`
  } else {
    score = 'ok'
    message = len < 120
      ? `Meta description is a bit short (${len} chars). Aim for 120–160 characters.`
      : `Meta description is a bit long (${len} chars). Try to keep it under 160 characters.`
  }

  return { key: 'meta-desc-length', label: 'Meta description length', score, message }
}

// ── Keyword in title ──────────────────────────────────────────────────────────

export function analyzeKeywordInTitle(title: string, keyword: string): SeoCheck {
  if (!keyword.trim()) {
    return { key: 'keyword-in-title', label: 'Keyword in SEO title', score: 'ok', message: 'No focus keyword set.' }
  }
  const found = title.toLowerCase().includes(keyword.toLowerCase())
  return {
    key: 'keyword-in-title',
    label: 'Keyword in SEO title',
    score: found ? 'good' : 'poor',
    message: found
      ? 'Focus keyword appears in the SEO title.'
      : 'Focus keyword is missing from the SEO title.',
  }
}

// ── Keyword in meta description ───────────────────────────────────────────────

export function analyzeKeywordInMetaDesc(desc: string, keyword: string): SeoCheck {
  if (!keyword.trim()) {
    return { key: 'keyword-in-desc', label: 'Keyword in meta description', score: 'ok', message: 'No focus keyword set.' }
  }
  const found = desc.toLowerCase().includes(keyword.toLowerCase())
  return {
    key: 'keyword-in-desc',
    label: 'Keyword in meta description',
    score: found ? 'good' : 'poor',
    message: found
      ? 'Focus keyword appears in the meta description.'
      : 'Focus keyword is missing from the meta description.',
  }
}

// ── Keyword density ───────────────────────────────────────────────────────────

export function analyzeKeywordDensity(content: string, keyword: string): SeoCheck {
  if (!keyword.trim()) {
    return { key: 'keyword-density', label: 'Keyword density', score: 'ok', message: 'No focus keyword set.' }
  }
  if (!content.trim()) {
    return { key: 'keyword-density', label: 'Keyword density', score: 'ok', message: 'No content to analyse.' }
  }

  const words = content.trim().toLowerCase().split(/\s+/)
  const kw = keyword.toLowerCase()
  const kwWords = kw.split(/\s+/)
  let count = 0

  if (kwWords.length === 1) {
    count = words.filter((w) => w === kw).length
  } else {
    for (let i = 0; i <= words.length - kwWords.length; i++) {
      if (kwWords.every((w, j) => words[i + j] === w)) count++
    }
  }

  const density = (count / words.length) * 100
  let score: SeoScore
  let message: string

  if (count === 0) {
    score = 'poor'
    message = 'Focus keyword does not appear in the content.'
  } else if (density > 5) {
    score = 'poor'
    message = `Keyword density is ${density.toFixed(1)}% - this may look like keyword stuffing. Aim for 1–3%.`
  } else if (density >= 1 && density <= 3) {
    score = 'good'
    message = `Keyword density is ${density.toFixed(1)}% - ideal range.`
  } else {
    score = 'ok'
    message = `Keyword density is ${density.toFixed(1)}%. Aim for 1–3%.`
  }

  return { key: 'keyword-density', label: 'Keyword density', score, message }
}

// ── Readability ───────────────────────────────────────────────────────────────

export function analyzeReadability(content: string): SeoCheck {
  if (!content.trim()) {
    return { key: 'readability', label: 'Sentence length', score: 'ok', message: 'No content to analyse.' }
  }

  const sentences = content.trim().split(/[.!?]+/).filter((s) => s.trim().length > 0)
  if (sentences.length === 0) {
    return { key: 'readability', label: 'Sentence length', score: 'ok', message: 'No sentences found.' }
  }

  const avgWords = sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / sentences.length

  let score: SeoScore
  let message: string

  if (avgWords <= 20) {
    score = 'good'
    message = `Average sentence length is ${avgWords.toFixed(0)} words - great readability.`
  } else if (avgWords <= 25) {
    score = 'ok'
    message = `Average sentence length is ${avgWords.toFixed(0)} words. Try to keep sentences under 20 words.`
  } else {
    score = 'poor'
    message = `Average sentence length is ${avgWords.toFixed(0)} words - sentences are too long. Aim for under 20 words.`
  }

  return { key: 'readability', label: 'Sentence length', score, message }
}

// ── Overall score ─────────────────────────────────────────────────────────────

export function computeOverallScore(checks: SeoCheck[]): SeoScore {
  if (checks.length === 0) return 'ok'
  const poorCount = checks.filter((c) => c.score === 'poor').length
  if (poorCount > checks.length / 2) return 'poor'
  const hasOk = checks.some((c) => c.score === 'ok' || c.score === 'poor')
  return hasOk ? 'ok' : 'good'
}
