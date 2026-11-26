/**
 * Universally copies text to clipboard across HTTPS, HTTP, older browsers, and mobile devices.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (!text) return false;

  // 1. Try modern Async Clipboard API if in a secure context (HTTPS/localhost)
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {}
  }

  // 2. Reliable Fallback using temporary textarea + execCommand for plain HTTP (non-TLS environments)
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (successful) return true;
  } catch (err) {
    console.warn('execCommand copy failed:', err);
  }

  // 3. Fallback prompt if both fail
  try {
    window.prompt('Copy to clipboard: Ctrl+C, Enter', text);
    return true;
  } catch (_) {}

  return false;
};
