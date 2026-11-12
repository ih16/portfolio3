'use strict';
const chat = require('./chat');
module.exports = (req, res) => {
  req.url = '/api/chat?action=cron';
  return chat(req, res);
};
