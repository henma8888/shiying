export function shouldShowInstall(canPrompt: boolean, standalone: boolean): boolean {
  return canPrompt && !standalone;
}
