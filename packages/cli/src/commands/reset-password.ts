/**
 * File Name: reset-password.ts
 * Purpose: `tangen reset-password <email>` — set a new password for an existing
 *          admin member. Connects directly to the environment's database,
 *          verifies the email exists, prompts for a new password (hidden), and
 *          writes a fresh argon2id hash. A recovery tool for locked-out owners.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Bun runtime (Bun.password.hash, argon2id — matches the
 *          server's hashing). Never prints or reads the existing hash.
 */
import { resolveDatabaseUrl } from './bootstrap'

const MIN_LENGTH = 8

/** Reads a line without echoing keystrokes (for password entry). */
async function promptHidden(question: string): Promise<string> {
  process.stdout.write(question)
  const stdin = process.stdin
  const wasRaw = stdin.isRaw
  if (stdin.isTTY) stdin.setRawMode(true)
  stdin.resume()

  return new Promise<string>((resolve) => {
    let input = ''
    const onData = (chunk: Buffer) => {
      const code = chunk[0]
      const ch = chunk.toString('utf8')
      if (code === 0x0a || code === 0x0d || code === 0x04) {         // LF, CR, EOF
        if (stdin.isTTY) stdin.setRawMode(wasRaw)
        stdin.pause()
        stdin.removeListener('data', onData)
        process.stdout.write('\n')
        resolve(input)
      } else if (code === 0x03) {                                    // Ctrl-C
        process.stdout.write('\n')
        process.exit(130)
      } else if (code === 0x7f || code === 0x08) {                   // backspace/delete
        input = input.slice(0, -1)
      } else if (code >= 0x20) {                                     // printable
        input += ch
      }
    }
    stdin.on('data', onData)
  })
}

/**
 * Reset an admin member's password.
 * @param email - The member email to reset (matched across all workspaces).
 * @param newPassword - Optional non-interactive password (skips the prompt).
 */
export async function runResetPasswordCommand(
  email: string,
  newPassword?: string,
): Promise<void> {
  const { c, sym } = await import('../ui')

  const target = email.trim().toLowerCase()
  if (!target || !target.includes('@')) {
    console.error('tangen: a valid email is required - usage: tangen reset-password <email>')
    process.exitCode = 1
    return
  }

  const resolvedDb = resolveDatabaseUrl(process.env)
  const dbUrl = resolvedDb.url
  if (!dbUrl) {
    console.error(`tangen: ${resolvedDb.error}`)
    process.exitCode = 1
    return
  }

  const { SQL } = await import('bun')
  const sql = new SQL(dbUrl)
  try {
    // Match across workspaces — the same email can be a member of several.
    const rows = await sql`SELECT id, workspace_id, name, role FROM members WHERE lower(email) = ${target}`
    if (rows.length === 0) {
      console.error(`\n  ${sym.cross ?? '✗'}  No member found with email ${c.cyan(target)} in this database.`)
      process.exitCode = 1
      return
    }

    console.log()
    console.log(`  ${c.bold(c.cyan('◆'))} ${c.bold('tangen reset-password')}  ${c.dim(target)}`)
    console.log(`  ${c.dim('found in:')} ${rows.map((r: { workspace_id: string; role: string }) => `${r.workspace_id} (${r.role})`).join(', ')}`)
    console.log()

    let password = newPassword
    if (!password) {
      password = await promptHidden('  New password: ')
      const confirm = await promptHidden('  Confirm password: ')
      if (password !== confirm) {
        console.error(`  ${sym.cross ?? '✗'}  Passwords do not match.`)
        process.exitCode = 1
        return
      }
    }

    if (!password || password.length < MIN_LENGTH) {
      console.error(`  ${sym.cross ?? '✗'}  Password must be at least ${MIN_LENGTH} characters.`)
      process.exitCode = 1
      return
    }

    const passwordHash = await Bun.password.hash(password, {
      algorithm: 'argon2id',
      memoryCost: 19456,
      timeCost: 2,
    })

    // Update every member row with this email (all workspaces) so a shared
    // account gets one consistent password.
    await sql`UPDATE members SET password_hash = ${passwordHash} WHERE lower(email) = ${target}`

    console.log(`  ${sym.tick}  Password updated for ${c.cyan(target)}${rows.length > 1 ? ` (${rows.length} workspace memberships)` : ''}.`)
    console.log()
  } finally {
    await sql.end().catch(() => {})
  }
}
