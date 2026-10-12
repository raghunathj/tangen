/**
 * File Name: extension-install-state.ts
 * Purpose: The API's import path for the extension install state writer,
 *          which lives in @tangen/db since closure plan Phase 4, Unit 8 so
 *          the CLI shares it. Nothing is defined here.
 *
 * Author: Raghunath J
 * License: MIT
 */
export {
  installExecFromDb, readInstall, listInstalls, isExtensionActive, activeExtensionIds, activeExtensionIdsDb,
  installExtension, setExtensionEnabled, recordInstalledVersion, discardInstall, uninstallExtension, syncDeclaredExtensionVersions,
  recordGrantedGrants, listGrantedGrants,
  type InstallExec, type ExtensionInstallState, type ExtensionInstallRow, type InstallInput,
} from '@tangen/db'
