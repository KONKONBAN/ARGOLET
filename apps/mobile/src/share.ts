import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Hands a file built by the app (e.g. an .xlsx book) to the system share sheet — Zalo, mail,
 * Files, Excel… — byte for byte. In the browser preview it is downloaded instead.
 */
export async function shareFile(filename: string, contentBase64: string, mime: string): Promise<void> {
  if (Platform.OS === 'web') {
    const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  await file.write(contentBase64, { encoding: 'base64' });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Thiết bị không hỗ trợ chia sẻ tệp');
  await Sharing.shareAsync(file.uri, {
    mimeType: mime,
    dialogTitle: filename,
    ...(filename.endsWith('.xlsx') ? { UTI: 'org.openxmlformats.spreadsheetml.sheet' } : {}),
  });
}
