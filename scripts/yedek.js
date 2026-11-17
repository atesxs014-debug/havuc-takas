// Elle yedek almak için: npm run yedek
const f = require('../lib/backup').run({ force: true });
console.log('Tamam:', f);
