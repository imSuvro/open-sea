// Inline all scripts into one self-contained file: open-sea.html (works from file://)
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (m, f) => '<script>\n' + fs.readFileSync(path.join(root, f), 'utf8').replace(/<\/script>/g, '<\/script>') + '\n</script>');
fs.writeFileSync(path.join(root, 'open-sea.html'), html);
console.log('open-sea.html', (html.length / 1024).toFixed(0) + ' KB');
