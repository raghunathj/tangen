/**
 * File Name: index.ts
 * Purpose: The pack's own entry: the contract, the connector and the rules
 *          about what a connection may reach. A connector pack has no Admin
 *          surface of its own.
 *
 * Author: Raghunath J
 * License: MIT
 */
export * from './contract'
export { smtpConnector, SMTP_BRAND, smtpHealth, allowsPrivate } from './connector'
export { smtpTarget, isPrivateHost, transportOptions, addressList, type SmtpSender, type SmtpSenderFactory } from './transport'
