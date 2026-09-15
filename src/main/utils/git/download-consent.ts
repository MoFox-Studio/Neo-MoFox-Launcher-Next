export interface UnverifiedDownload {
  repository: string;
  version: string;
  assetName: string;
  reason: string;
}

type Confirmation = (request: UnverifiedDownload, signal?: AbortSignal) => Promise<boolean>;
let confirmation: Confirmation = async () => false;

/** Only the main-process composition root may install a confirmation UI. No persistent bypass. */
export function setUnverifiedDownloadConfirmation(handler: Confirmation): void {
  confirmation = handler;
}

export async function confirmUnverifiedDownload(
  request: UnverifiedDownload,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;
  const accepted = await confirmation(request, signal);
  return !signal?.aborted && accepted;
}
