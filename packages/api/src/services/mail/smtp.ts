/**
 * File Name: smtp.ts
 * Purpose: SMTP adapter via nodemailer - host, port and credentials from the
 *          resolved deployment's mail.smtp.* keys (service-settings.ts).
 *
 * Author: Raghunath J
 * License: MIT
 */
import nodemailer, { type Transporter } from 'nodemailer'
import type { MailAdapter } from './types'

export interface SmtpSettings { host: string; port: number; user?: string; pass?: string }

/** From the resolved deployment (mail.smtp.*); never from the process environment. */
export function buildSmtpTransporter(smtp: SmtpSettings = { host: 'localhost', port: 587 }): Transporter {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: false,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  })
}

export function createSmtpAdapter(transporter: Transporter = buildSmtpTransporter()): MailAdapter {
  return {
    name: 'smtp',
    async send(message) {
      await transporter.sendMail({
        from: message.from,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        ...(message.text ? { text: message.text } : {}),
        ...(message.html ? { html: message.html } : {}),
      })
    },
  }
}
