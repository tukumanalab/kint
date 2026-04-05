/** WebUSB が利用可能なブラウザかどうかを返す */
export function isWebUSBSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}
