// This advisor edition only offers direct analysis and PDF downloads.
module.exports = function handler(req, res) {
  return res.status(410).json({ error: 'Email and CRM submissions are disabled in this edition.' });
};
