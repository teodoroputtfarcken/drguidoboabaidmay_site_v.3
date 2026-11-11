const express = require('express');
const cms = require('./cms/app');

const app = express();
app.use(cms);
module.exports = app;
