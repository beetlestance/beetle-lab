/**
 * Start both originals independently. A stalled browser must not retain Compose.
 * @param {() => Promise<unknown>} closeBrowser
 * @param {() => Promise<{verified: boolean}>} closeInstallation
 */
export async function cleanupBrowserInstallation(closeBrowser, closeInstallation) {
  const browser = Promise.resolve().then(closeBrowser);
  const installation = Promise.resolve().then(closeInstallation);
  const [browserResult, installationResult] = await Promise.allSettled([browser, installation]);
  return {browserClosed: browserResult.status === 'fulfilled',
    cleanupVerified: installationResult.status === 'fulfilled' && installationResult.value.verified === true};
}
