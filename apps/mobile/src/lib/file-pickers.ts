import { requireOptionalNativeModule } from 'expo';

type ImagePicker = typeof import('expo-image-picker');
type DocumentPicker = typeof import('expo-document-picker');

let ip: ImagePicker | null | undefined;
let dp: DocumentPicker | null | undefined;

/**
 * Receipt pickers, guarded like lib/blur.ts: null when this binary was built before
 * expo-image-picker / expo-document-picker were added, so the attach buttons hide instead of crashing.
 */
export function getImagePicker(): ImagePicker | null {
  if (ip !== undefined) return ip;
  ip = null;
  try {
    if (requireOptionalNativeModule('ExponentImagePicker') != null)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ip = require('expo-image-picker') as ImagePicker;
  } catch {
    ip = null;
  }
  return ip;
}

export function getDocumentPicker(): DocumentPicker | null {
  if (dp !== undefined) return dp;
  dp = null;
  try {
    if (requireOptionalNativeModule('ExpoDocumentPicker') != null)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      dp = require('expo-document-picker') as DocumentPicker;
  } catch {
    dp = null;
  }
  return dp;
}

/** A picked file, ready to upload. */
export type PickedFile = { uri: string; name: string; type: string; size: number };

export async function pickPhoto(camera: boolean): Promise<PickedFile | null> {
  const p = getImagePicker();
  if (!p) return null;
  const perm = camera
    ? await p.requestCameraPermissionsAsync()
    : await p.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Allow access in Settings to attach a receipt photo.');
  const opts = { mediaTypes: ['images' as const], quality: 0.7 };
  const r = camera ? await p.launchCameraAsync(opts) : await p.launchImageLibraryAsync(opts);
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  const name = a.fileName || `receipt-${Date.now()}.jpg`;
  return { uri: a.uri, name, type: a.mimeType || 'image/jpeg', size: a.fileSize ?? 0 };
}

export async function pickDocument(): Promise<PickedFile | null> {
  const p = getDocumentPicker();
  if (!p) return null;
  const r = await p.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  return { uri: a.uri, name: a.name, type: a.mimeType ?? '', size: a.size ?? 0 };
}
