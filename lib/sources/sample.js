'use strict';
const { generateSample } = require('../sample');
module.exports = {
  id: 'sample', label: 'Sample data (not real)', kind: 'sample',
  status: () => ({ available: true, configured: true, note: 'Generated, clearly labelled demo data so the app works before an upload.' }),
  load: () => generateSample(60),
};
