/**
 * File Name: delivery.ts
 * Purpose: Getting a one-time code or a reset token to the person: the
 *          site's hook when it has one, else the workspace mailer for email
 *          and the site's `sms.send` for phones. Never logs the address or
 *          the secret.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/cms'
import type { OtpDelivery } from './contract'
import { hookCtx, hooksOf, optionsOf } from './context'
import { RequestError } from './errors'

function fromOf(ctx: ExtensionServerCtx): string | undefined {
  const mail = optionsOf(ctx).mail
  if (!mail?.fromEmail) return undefined
  return mail.fromName ? `${mail.fromName} <${mail.fromEmail}>` : mail.fromEmail
}

async function sendMail(ctx: ExtensionServerCtx, to: string, subject: string, text: string): Promise<void> {
  if (!ctx.tangen?.sendMail) throw new RequestError('INTERNAL', 'Site users: no mailer is available to deliver the message (configure app/config/mail.ts, or a hook)', 500)
  const from = fromOf(ctx)
  await ctx.tangen.sendMail({ to, subject, text, ...(from ? { from } : {}) })
}

export async function deliverOtp(ctx: ExtensionServerCtx, delivery: OtpDelivery): Promise<void> {
  const hook = hooksOf(ctx).onOtpSend
  if (hook) { await hook(delivery, hookCtx(ctx)); return }
  const minutes = Math.max(1, Math.round(delivery.ttlSeconds / 60))
  if (delivery.channel === 'email') {
    const subject = optionsOf(ctx).mail?.otpSubject ?? 'Your sign-in code'
    await sendMail(ctx, delivery.to, subject, `Your sign-in code is ${delivery.code}. It expires in ${minutes} minutes. If you did not ask for it, ignore this message.`)
    return
  }
  const sms = optionsOf(ctx).sms
  if (!sms?.send) throw new RequestError('OTP_UNDELIVERABLE', 'Codes by SMS need an `sms.send` option or an `onOtpSend` hook', 501)
  await sms.send(delivery.to, `${delivery.code} is your sign-in code. It expires in ${minutes} minutes.`)
}

export async function deliverPasswordReset(ctx: ExtensionServerCtx, email: string, token: string): Promise<void> {
  const hook = hooksOf(ctx).onPasswordResetRequest
  if (hook) { await hook(email, token, hookCtx(ctx)); return }
  const subject = optionsOf(ctx).mail?.resetSubject ?? 'Reset your password'
  await sendMail(ctx, email, subject, `Use this token to set a new password: ${token}\n\nIt expires in one hour. If you did not ask for it, ignore this message.`)
}
