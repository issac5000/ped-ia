export function renderMarkdownSimple(text) {
  const raw = text == null ? '' : String(text);
  if (!raw) return '';
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const withBold = escaped.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  const withItalic = withBold.replace(/\*(?!\*)([\s\S]+?)\*(?!\*)/g, '<em>$1</em>');
  return withItalic;
}
