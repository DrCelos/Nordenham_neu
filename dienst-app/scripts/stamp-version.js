// Läuft bei jedem Netlify-Deploy: schreibt eine neue Versionsnummer nach public/version.json.
// Die App fragt diese Datei regelmäßig ab und lädt sich selbst neu, sobald sich die Nummer ändert.
const fs = require('fs');
const path = require('path');
const v = (process.env.COMMIT_REF || '').slice(0, 8) + '-' + Date.now();
fs.writeFileSync(path.join(__dirname, '..', 'public', 'version.json'), JSON.stringify({ v }) + '\n');
console.log('version.json ->', v);
